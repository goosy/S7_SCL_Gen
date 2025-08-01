import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { posix } from 'node:path';
import { isSeq } from 'yaml';
import { context, multi_sort, pad_right, pad_left, elog } from './util.js';
import {
    S7HashList, IntHashList, HLError,
    s7addr2foct, foct2S7addr
} from "./s7data.js";
import { GCL, isString, get_Seq } from './gcl.js';

export const BUILDIN_SYMBOLS = await GCL.load(posix.join( // Initialized by converter.js
    import.meta.dirname.replace(/\\/g, '/'),
    'symbols_buildin.yaml',
));

export const WRONGTYPESYMBOLS = new Set();

/**
 * @typedef {object} Source
 * @property {string[]} raw
 * @property {import('yaml').Document} document
 * @property {number[]} range
 */

// FB|FC|SFB|SFC|DB|UDT|MD|PID|ID|PQD|QD|MW|PIW|IW|PQW|QW|MB|PIB|IB|PQB|QB|M|I|Q
const INDEPENDENT_PREFIX = ['OB', 'FB', 'FC', 'SFB', 'SFC', 'UDT'];
const INTEGER_PREFIX = [...INDEPENDENT_PREFIX, 'DB'];
const DWORD_PREFIX = ['MD', 'ID', 'PID', 'QD', 'PQD'];
const WORD_PREFIX = ['MW', 'IW', 'PIW', 'QW', 'PQW'];
const BYTE_PREFIX = ['MB', 'IB', 'PIB', 'QB', 'PQB'];
const BIT_PREFIX = ['M', 'I', 'Q'];
const S7MEM_PREFIX = [...DWORD_PREFIX, ...WORD_PREFIX, ...BYTE_PREFIX, ...BIT_PREFIX];
const COMMON_TYPE = ['BOOL', 'BYTE', 'INT', 'WORD', 'DWORD', 'DINT', 'REAL'];
export function is_common_type(type) {
    if (typeof type !== 'string') return false;
    return COMMON_TYPE.includes(type.toUpperCase());
}

// regexp = /^(OB|FB|FC||SFB|SFC|UDT|DB|MD|ID|PID|QD|PQD|MW|IW|PIW|QW|PQW|MB|IB|PIB|QB|PQB|M|I|Q)(\d+|\+)(\.(\d))?$/
const S7ADDR_REG = new RegExp(`^(${[...INTEGER_PREFIX, ...S7MEM_PREFIX].join('|')})(\\d+|\\+)(\\.(\\d))?$`);

// equal area_size = { M: 0.1, I: 0.1, Q: 0.1, MB: 1, ... PQD: 4};
const area_size = {};
for (const prefix of BIT_PREFIX) area_size[prefix] = 0.1;
for (const prefix of BYTE_PREFIX) area_size[prefix] = 1.0;
for (const prefix of WORD_PREFIX) area_size[prefix] = 2.0;
for (const prefix of DWORD_PREFIX) area_size[prefix] = 4.0;

/**
 * Get symbol information
 * @param {Symbol} symbol
 * @return {string}
 */
function get_msg(symbol) {
    /**
     * @type {GCL}
     */
    const gcl = symbol.source.document.gcl;
    if (gcl) {
        const info = gcl.get_pos_info(...symbol.source.range);
        return `
        符号: ${symbol.name}${info}`;
    }
    return `内置符号 symbol:${symbol.name}`
};

/**
 * throws 2 symbol conflict exceptions
 * @param {string} message
 * @param {Symbol} curr_symbol
 * @param {Symbol} prev_symbol
 */
function throw_symbol_conflict(message, curr_symbol, prev_symbol) {
    const prev_msg = prev_symbol ? `previous symbol position 先前符号信息: ${get_msg(prev_symbol)}\n` : '';
    const curr_msg = curr_symbol ? `current symbol position 当前符号信息: ${get_msg(curr_symbol)}\n` : '';
    console.error(`${message}\n${prev_msg}${curr_msg}`);
    process.exit(10);
}

class S7Symbol {
    /**
     * @type {string}
     */
    value;
    /**
     * @type {string}
     */
    block_name;
    /**
     * @type {number}
     */
    block_no;
    /**
     * @type {number}
     */
    block_bit;
    /**
     * @type {string}
     */
    type_name;
    /**
     * @type {number}
     */
    type_no;
    /**
     * @type {Source}
     */
    source;
    /**
     * @type {S7SymbolEmitter}
     */
    symbols;
    #symbol_error() {
        return new SyntaxError(`symbol define ${this.source.raw} is wrong!`);
    }

    parse_s7addr(address) {
        const [, block_name, block_no, , block_bit = 0] = S7ADDR_REG.exec(address.toUpperCase()) ?? [];
        if (!block_name || !block_no) elog(this.#symbol_error());
        return [block_name, block_no, block_bit];
    }

    /**
     * @type {string}
     */
    _name;
    get name() {
        return this._name
    }
    set name(name) {
        assert.equal(typeof name, 'string', this.#symbol_error());
        this._name = name;
    }

    /**
     * @type {string}
     */
    _address;
    get address() {
        return this._address;
    }
    set address(address) {
        assert.equal(typeof address, 'string', this.#symbol_error());
        const [block_name, block_no, block_bit] = this.parse_s7addr(address);
        this.block_name = block_name;
        this.block_no = block_no === '+' ? null : Number.parseInt(block_no); // null 代表自动分配
        this.block_bit = Number.parseInt(block_bit);
        this._address = address;
    }

    /**
     * @type {boolean}
     */
    exportable = true; // By default, it can be exported to a symbol file.

    /**
     * Checks the compatibility with specified type.
     *
     * @param {string} type - The type to compare with this symbol.
     * @return {boolean} True if this symbol is compatible with the type, false otherwise.
     */
    check_type_compatibility(type) {
        //type must be string
        assert.equal(typeof type, 'string', this.#symbol_error);

        // this.type startswith INDEPENDENT_PREFIX = itself
        if (INDEPENDENT_PREFIX.includes(this.block_name)) {
            return type === this.name;
        }

        // this.type startswith 'DB' must be a symbol name
        if (this.block_name === 'DB') {
            if (is_common_type(type)) return false;
            // the symbol of type must be one of DB FB SFB UDT
            // it will checking on this.complete_type()
            // if (type == this.name) return true;
            return true;
        }

        // this.type startswith DWORD_PREFIX must one of 'DWORD' 'DINT' 'REAL'
        if (DWORD_PREFIX.includes(this.block_name)) {
            return ['DWORD', 'DINT', 'REAL'].includes(type);
        }

        // this.type startswith WORD_PREFIX must one of 'INT', 'WORD'
        if (WORD_PREFIX.includes(this.block_name)) {
            return ['WORD', 'INT'].includes(type);
        }

        // this.type startswith BYTE_PREFIX must be 'BYTE'
        if (BYTE_PREFIX.includes(this.block_name)) {
            return 'BYTE' === type;
        }

        // this.type startswith BIT_PREFIX must be 'BOOL'
        if (BIT_PREFIX.includes(this.block_name)) {
            return 'BOOL' === type;
        }

        return false;
    }
    /**
     * @type {string|null}
     */
    _type;
    get type() {
        return this._type;
    }
    set type(name) {
        let type;
        if (typeof name === "string") {
            const UC_type = name.toUpperCase();
            if (is_common_type(UC_type)) {
                type = UC_type;
            } else {
                type = name;
            }
        } else {
            type = null;
        }
        const block_name = this.block_name;
        if (type === this.address || INDEPENDENT_PREFIX.includes(block_name)) {
            //FB FC SFB SFC UDT type is itself
            type = this.name;
        }
        if (type == null) { //The default value if the type value is invalid
            if (block_name === 'DB') {
                type = this.name;
            } else if (DWORD_PREFIX.includes(block_name)) {
                type = 'DWORD';
            } else if (WORD_PREFIX.includes(block_name)) {
                type = 'WORD';
            } else if (BYTE_PREFIX.includes(block_name)) {
                type = 'BYTE';
            } else if (BIT_PREFIX.includes(block_name)) {
                type = 'BOOL';
            }
        }

        if (this.check_type_compatibility(type)) {
            this._type = type;
            if (this.userDefinedType && this.userDefinedType !== type) {
                WRONGTYPESYMBOLS.add(this);
            }
        } else {
            throw_type_incompatible(this, type);
        }
        // const [type_name, type_no] = parse_s7addr(type);
    }
    complete_type() {
        if (INDEPENDENT_PREFIX.includes(this.block_name) || this.type == null) {
            this.type = this.name;
        }
        if (is_common_type(this.type)) {
            this.type_name = this.type;
            this.type_no = '';
        } else {
            const type_block = this.symbols.get(this.type);
            if (!type_block) {
                console.error('\n\nsymbol ERROR!!! 符号错误！！！');
                console.error(`type ${this.type} is required, but not defined`);
                console.error(`需要符号类型${this.type}，但是该类型未定义`);
                console.error(`current symbol information 当前符号信息: ${get_msg(this)}`);
                process.exit(10);
            }
            // The type of DB symbol must be itself, or a FB SFB UDT symbol name
            if (
                this.block_name === 'DB'
                && this.name !== this.type
                && !['FB', 'SFB', 'UDT'].includes(type_block.block_name)
            ) {
                throw_type_incompatible(this, this.type);
            }

            this.type_name = type_block.block_name;
            this.type_no = type_block.block_no;
        }
    }

    _comment;
    get comment() {
        return this._comment;
    }
    set comment(comment) {
        if (typeof comment === 'string') this._comment = comment;
        else this._comment = '';
    }

    constructor(source) {
        this.source = source;
        const raw = source.raw;
        this.name = raw[0];
        this.address = raw[1];
        let type = raw[2];
        if (typeof type === "string") {
            if (is_common_type(type)) {
                type = type.toUpperCase();
            }
            this.userDefinedType = type;
        }
        this.type = type;
        this.comment = raw[3];
        this.value = `"${this.name}"`;
    }
}

export class S7SymbolEmitter extends EventEmitter {
    #dict = {}; // Dictionary by name
    #dict_by_address = {}; // Dictionary by address

    OB_list = new IntHashList(100);     // List of used OBs
    DB_list = new IntHashList(100);     // List of used DBs
    FB_list = new IntHashList(256);     // List of used FBs
    FC_list = new IntHashList(256);     // List of used FCs
    SFB_list = new IntHashList(256);    // List of used SFBs
    SFC_list = new IntHashList(256);    // List of used SFBs
    UDT_list = new IntHashList(256);    // List of used UDTs
    MA_list = new S7HashList(0.0);      // Used M address
    IA_list = new S7HashList(0.0);      // Used I address
    QA_list = new S7HashList(0.0);      // Used Q address
    PIA_list = new S7HashList(0.0);     // Used PI address
    PQA_list = new S7HashList(0.0);     // Used PQ address

    #buildin = []; // List of built-in symbol names for this CPU
    is_buildin(name) {
        return this.#buildin.includes(name);
    }
    push_buildin(...items) {
        this.#buildin.push(...items);
    }

    /**
     * Adds a symbol to the dictionary with the given name.
     *
     * @param {string} name - the name of the symbol
     * @param {S7Symbol} symbol - the symbol to be added
     * @return {void}
     */
    add(name, symbol) {
        this.#dict[name] = symbol;
        this.emit(`${name}_added`, symbol);
    }

    /**
     * Get the value associated with the given name from the dictionary.
     *
     * @param {string} name - The name of the value to retrieve
     * @return {S7Symbol} The value associated with the given name
     */
    get(name) {
        return this.#dict[name];
    }

    /**
     * Getter for the list property, returns an array of values from the internal dictionary.
     *
     * @return {S7Symbol[]} An array of values from the internal dictionary.
     */
    get list() {
        return Object.values(this.#dict);
    }

    /**
     * Build symbols based on the given list of symbols, including handling various prefixes
     * and checking for duplicate addresses.
     */
    build_symbols() {
        // build symbol.block_no and symbol.address
        // Check for duplicates and index
        for (const symbol of this.list) {
            const name = symbol.name;
            let decimal_places = 0;
            try {
                if (INTEGER_PREFIX.includes(symbol.block_name)) { // Automatically assign OB DB FB FC SFB SFC UDT block numbers
                    const area_list = this[`${symbol.block_name}_list`];
                    // The push method may throw an exception, 
                    // so assign symbol.address temporarily first.
                    symbol.address = symbol.block_name + (symbol.block_no?.toFixed(0) ?? '+');
                    const block_no = area_list.push(symbol.block_no);
                    if (block_no !== symbol.block_no) {
                        symbol.block_no = block_no;
                        symbol.address = symbol.block_name + block_no;
                    }
                } else if (S7MEM_PREFIX.includes(symbol.block_name)) {
                    // list is one of PIA_list, PQA_list, MA_list, IA_list, QA_list
                    const prefix = ['PI', 'PQ', 'M', 'I', 'Q'].find(prefix => symbol.block_name.startsWith(prefix));
                    const area_list = this[`${prefix}A_list`];
                    if (symbol.type === 'BOOL') decimal_places = 1;
                    const s7addr = symbol.block_no == null
                        ? null // Area automatically assigns addresses
                        : foct2S7addr(symbol.block_no, symbol.block_bit);
                    const size = area_size[symbol.block_name];
                    // The push method may throw an exception, 
                    // so assign symbol.address temporarily first.
                    symbol.address = symbol.block_name + (s7addr?.toFixed(decimal_places) ?? '+');
                    const final_s7addr = area_list.push(s7addr, size);
                    if (s7addr !== final_s7addr) {
                        symbol.address = symbol.block_name + final_s7addr.toFixed(decimal_places);
                        const [block_no, block_bit] = s7addr2foct(final_s7addr);
                        symbol.block_no = block_no;
                        symbol.block_bit = block_bit;
                    }
                } else if (this.#dict_by_address[symbol.address]) { // Check for duplication in other cases
                    elog(new RangeError(`重复地址 Duplicate address ${name} ${symbol.address}!`));
                }
                // If it is not repeated, it indicates that the address already exists.
                this.#dict_by_address[symbol.address] = symbol;
            } catch (e) {
                if (e instanceof HLError || e instanceof RangeError) {
                    throw_symbol_conflict(
                        `符号地址错误 Symbol address error:\n\t${e.message}`,
                        symbol,
                        this.#dict_by_address[symbol.address],
                    );
                } else if (e instanceof TypeError) {
                    elog(new TypeError(e.message, { cause: e }));
                } else {
                    elog(e);
                }
            }
            // Completion type
            symbol.complete_type();
        }
    }

    constructor() {
        super();
        this.#buildin = BUILDIN_SYMBOLS.documents.flatMap(doc => {
            const symbols = get_Seq(doc, 'symbols').map(symbol => symbol.items[0].value);
            const reference_symbols = get_Seq(doc, 'reference_symbols').map(symbol => symbol.items[0].value);
            return [...symbols, ...reference_symbols];
        });
        this.setMaxListeners(1024);
        this.on('finished', this.build_symbols);
    }
}

/**
 * Convert the original symbols and add them to CPU.symbols
 * @param {import('yaml').Document} document - The document in which the symbol is located
 * @param {import('yaml').Node|string[]} symbol_raw - symbol input value
 * @returns {S7Symbol}
 */
export function add_symbol(document, symbol_raw) {
    const is_Seq = isSeq(symbol_raw);
    const symbol_definition = is_Seq ? JSON.parse(symbol_raw) : symbol_raw;
    if (!Array.isArray(symbol_definition)) throw_symbol_conflict(`符号必须是一个定义正确数组！ 原始值:"${symbol_definition}"`);
    const symbols = document.CPU.symbols;
    /**
     * @type {Source}
     */
    const source = {
        raw: symbol_definition,
        document,
        range: is_Seq ? symbol_raw.range : [0, 0, 0]
    }
    // Generate symbols
    const symbol = new S7Symbol(source);
    symbol.symbols = symbols;

    const name = symbol.name;
    const ref = symbols.get(name);
    if (ref) {
        if (symbols.is_buildin(name)) {
            // If the built-in symbol already exists, the new address will be used.
            ref.address = symbol.address;
            return ref;
        }
        // Duplication of symbol names is not allowed
        throw_symbol_conflict(`符号"${name}"名称重复!`, symbol, symbols.get(name));
    }
    // The new symbol is saved
    symbols.add(name, symbol);
    return symbol;
}

/**
 * Parses the specified symbol definition list and returns the S7 symbol list
 * Should only be used to simply add symbols to a CPU
 * For symbols in specific configurations, make_prop_symbolic should be used.
 * @param {import('yaml').Document} document
 * @param {String[]|import('yaml').YAMLSeq} symbol_list
 * @returns {S7Symbol[]}
 */
export function add_symbols(document, symbol_list) {
    if (Array.isArray(symbol_list)) {
        return symbol_list.map(symbol_raw => add_symbol(document, symbol_raw));
    }
    return [];
}

function isS7Express(str) {
    if (typeof str !== 'string') return false;
    const expr = str.replace(/"[^"]+"/g, '');
    return /,|\+|-|\*|\/|\bnot\b|\band\b|\bor\b|\bxor\b|\bdiv\b|\bmod\b|\bshl\b|\bshr\b/i.test(expr);
}
function ref(item) {
    let ret = null;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        const isExpress = isS7Express(item);
        ret = {
            value: item,
            type: 'ref',
            isExpress,
            toString() {
                return this.value.toString();
            }
        };
    }
    return ret;
}

function throw_type_incompatible(symbol, type) {
    console.error('\n\nsymbol type incompatible! 符号类型不兼容!');
    console.error(`current symbol information 当前符号信息: ${get_msg(symbol)}
        错误: ${type}`
    );
    process.exit(10);
}

function apply_default_force(symbol, options) {
    const force_type = options?.force?.type;
    if (typeof force_type === 'string') {
        // Force specified types, completely ignoring user definitions
        if (symbol.check_type_compatibility(force_type)) {
            symbol.type = force_type;
            if (symbol.userDefinedType && symbol.userDefinedType !== force_type) {
                WRONGTYPESYMBOLS.add(symbol);
            }
        } else {
            throw_type_incompatible(symbol, force_type);
        }
    } else {
        // Default type
        symbol.type ??= options?.default?.type;
    }
    const force_comment = options?.force?.comment;
    if (typeof force_comment === 'string') {
        // Force comments to be specified, completely ignoring user definitions
        symbol.comment = force_comment;
    } else if (symbol.comment === '') {
        // Default comment
        symbol.comment = options?.default?.comment;
    }
}

export async function make_s7_expression(value, infos = {}) {
    // Allowed by default: Symbol definition, Symbolic link, S7 expression, Undefined
    const disallow_null = infos.disallow_null === true;
    const disallow_s7express = infos.disallow_s7express === true;
    const allow_symbol_def = infos.disallow_symbol_def !== true;
    const allow_symbol_link = infos.disallow_symbol_link !== true;

    const { document, s7_expr_desc } = infos;
    const { symbols, async_symbols, non_symbols } = document.CPU;
    // biome-ignore lint/suspicious/noDoubleEquals: it may be null
    if (value == undefined) {
        if (disallow_null) elog(new Error('不允许空值'));
        return value;
    }

    if ((Array.isArray(value) || isSeq(value)) && allow_symbol_def) {
        // If it is a symbol definition, return the converted symbol object.
        const symbol = add_symbol(document, value);
        apply_default_force(symbol, infos);
        return symbol;
    }

    const expression = isString(value) ? value.value : value;

    function do_s7expr() {
        if (disallow_s7express) elog(new SyntaxError('不允许非符号 S7 表达式'));
        const s7expr = ref(expression);
        if (!s7expr) elog(new SyntaxError('非有效的 S7 表达式'));
        non_symbols.push({ expression, desc: s7_expr_desc });
        return s7expr;
    }

    if (typeof expression === 'string' && allow_symbol_link) {
        // If the reference is valid, the reference symbol is returned.
        const symbol = symbols.get(expression);
        if (symbol) {
            apply_default_force(symbol, infos); // { force, default}
            return symbol;
        }

        // If the reference is invalid, an asynchronous assignment is performed
        // because all symbols have not yet been fully loaded.
        // Symbol completion is assigned to the final symbol or S7 expression object
        const promise = new Promise((resolve, reject) => {
            const fn = () => resolve(do_s7expr());
            symbols.on(`${expression}_added`, (symbol) => {
                // If the reference exists, the reference symbol is returned.
                symbols.removeListener('finished', fn);
                resolve(symbol);
            });
            symbols.on('finished', fn);
        });
        async_symbols.push(promise);
        return promise;
    }
    return do_s7expr(); // Get S7 expression
}

const SYMN_LEN = 23;
const NAME_LEN = 4;
const NO_LEN = 5;
const BLANK_COMMENT_LEN = 80;
/**
 * Generate step7 symbol source code line, fixed length, where each field is expressed as <field description and number of characters>
 *
 * * `126,<symname23> <block_name_str4><block_no_str5><block_bit_str2> <type_str4><type_no_str5> <comment80>`
 *
 * @date 2022-11-09
 * @param {S7Symbol} symbol
 * @returns {string}
 */
function get_step7_symbol({ name, type, block_name, block_no, block_bit, type_name, type_no = '', comment, exportable }) {
    if (!exportable) return [];
    return {
        name, type, block_name, block_no, block_bit, type_name, type_no, comment,
        get address() {
            return pad_right(this.block_name, NAME_LEN)
                + pad_left(this.block_no, NO_LEN)
                + (this.type === 'BOOL' ? `.${this.block_bit}` : '  ');
        },
        get line() {
            const name_str = pad_right(this.name, SYMN_LEN);
            const type_str = pad_right(this.type_name, NAME_LEN) + pad_left(this.type_no, NO_LEN);
            const cm = pad_right(this.comment, BLANK_COMMENT_LEN);
            return `126,${name_str} ${this.address} ${type_str} ${cm}`;
        },
    };
}

/**
 * Generate portal symbol source lines, where each field is wrapped in quotes and replaced with actual values.
 *
 * * `"name","address","type","accessiable","visiable","retain","comment","supervision","writable"`
 *
 * @date 2022-11-09
 * @param {S7Symbol} symbol
 * @returns {string}
 */
function get_portal_symbol({ name, type, address, block_name, comment, exportable }) {
    if (!exportable) return [];
    if (INTEGER_PREFIX.includes(block_name)) return []; // Symbols of OB, FB, FC, SFB, SFC, UDT are not generated
    return {
        name, type, address, block_name, comment,
        get line() {
            return `"${this.name}","%${this.address}","${this.type}","True","True","False","${this.comment}","","True"`
        },
    };
}

const template = `{{for symbol in list}}_
{{symbol.line}}
{{endfor // symbol}}`;

export function gen_symbols(cpu) {
    const list = cpu.symbols.list.flatMap(cpu.platform === "portal" ? get_portal_symbol : get_step7_symbol);
    multi_sort(list, ['address', 'name']);
    // return { cpu_name, feature, platform, OE, line_ending, type, tags, template, distance, output_dir }
    return {
        cpu_name: cpu.name,
        feature: 'symbol',
        platform: cpu.platform,
        distance: `${cpu.output_dir}/symbols.${cpu.platform === "portal" ? 'sdf' : 'asc'}`,
        output_dir: context.work_path,
        tags: { list },
        template,
    };
}

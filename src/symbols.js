import assert from 'assert/strict';
import { compare_str, pad_right, pad_left } from './util.js';
import {
    S7HashList, IntHashList, HLError,
    s7addr2foct, foct2S7addr
} from "./s7data.js";
import { GCL, isString, get_Seq } from './gcl.js';
import { isSeq } from 'yaml';
import { posix } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

export const BUILDIN_SYMBOLS = new GCL(); // Initialized by converter.js
await BUILDIN_SYMBOLS.load(posix.join(
    fileURLToPath(import.meta.url).replace(/\\/g, '/'),
    '../symbols_buildin.yaml'
));

export const NON_SYMBOLS = [];
export const WRONGTYPESYMBOLS = new Set();
export const SYMBOL_PROMISES = [];

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
BIT_PREFIX.forEach(prefix => area_size[prefix] = 0.1);
BYTE_PREFIX.forEach(prefix => area_size[prefix] = 1.0);
WORD_PREFIX.forEach(prefix => area_size[prefix] = 2.0);
DWORD_PREFIX.forEach(prefix => area_size[prefix] = 4.0);

/**
 * 取得符号信息
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
 * 抛出2个符号冲突异常
 * @date 2022-11-09
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
        if (!block_name || !block_no) throw this.#symbol_error();
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
        this.block_no = block_no === '+' ? null : parseInt(block_no); // null 代表自动分配
        this.block_bit = parseInt(block_bit);
        this._address = address;
    }

    /**
     * @type {boolean}
     */
    exportable = true; // 默认可导出到符号文件里

    /**
     * Checks the compatibility with specified type.
     *
     * @param {string} type - The type to compare with this symbol.
     * @return {boolean} True if this symbol is compatible with the type, false otherwise.
     */
    check_type_compatibility(type) {
        // this.type startswith INDEPENDENT_PREFIX = itself
        if (INDEPENDENT_PREFIX.includes(this.block_name)) {
            return type == this.name;
        }

        // this.type startswith 'DB' must be a symbol name
        if (this.block_name == 'DB') {
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
            return 'BYTE' == type;
        }

        // this.type startswith BIT_PREFIX must be 'BOOL'
        if (BIT_PREFIX.includes(this.block_name)) {
            return 'BOOL' == type;
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
    set type(type) {
        if (typeof type === "string") {
            const UC_type = type.toUpperCase();
            if (is_common_type(UC_type)) {
                type = UC_type;
            }
        } else {
            type = null;
        }
        const block_name = this.block_name;
        if (type === this.address || INDEPENDENT_PREFIX.includes(block_name)) {
            // FB FC SFB SFC UDT 的类型是自己
            type = this.name;
        }
        if (type) {
            // type 必须是字符串
            assert.equal(typeof type, 'string', this.#symbol_error);
        } else if (block_name === 'DB') {
            // DB的默认类型是自己
            type = this.name;
        } else if (DWORD_PREFIX.includes(block_name)) {
            // 默认类型是 DWORD
            type = 'DWORD';
        } else if (WORD_PREFIX.includes(block_name)) {
            // 默认类型是 WORD
            type = 'WORD';
        } else if (BYTE_PREFIX.includes(block_name)) {
            // 默认类型是 BYTE
            type = 'BYTE';
        } else if (BIT_PREFIX.includes(block_name)) {
            // M I Q 的默认类型是 BOOL
            type = 'BOOL';
        }

        if (this.check_type_compatibility(type)) {
            this._type = type;
            if (this.userDefinedType && this.userDefinedType != type) {
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
                console.error(`\n\nsymbol ERROR!!! 符号错误！！！`);
                console.error(`type ${this.type} is required, but not defined`);
                console.error(`需要符号类型${this.type}，但是该类型未定义`);
                console.error(`current symbol information 当前符号信息: ${get_msg(this)}`);
                process.exit(10);
            }
            // DB符号的类型，必须是它自身，或者是一个 FB SFB UDT 符号名
            if (
                this.block_name == 'DB'
                && this.name != this.type
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
        if (typeof comment == 'string') this._comment = comment;
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
    #dict = {};

    OB_list = new IntHashList(100);     // 已用组织块列表
    DB_list = new IntHashList(100);     // 已用数据块列表
    FB_list = new IntHashList(256);     // 已用函数块列表
    FC_list = new IntHashList(256);     // 已用函数列表
    SFB_list = new IntHashList(256);    // 已用系统函数块列表
    SFC_list = new IntHashList(256);    // 已用系统函数列表
    UDT_list = new IntHashList(256);    // 已用自定义类型列表
    MA_list = new S7HashList(0.0);   // 已用M地址
    IA_list = new S7HashList(0.0);   // 已用I地址
    QA_list = new S7HashList(0.0);   // 已用Q地址
    PIA_list = new S7HashList(0.0);  // 已用PI地址
    PQA_list = new S7HashList(0.0);  // 已用PQ地址

    #buildin = []; // 该CPU的内置符号名称列表
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
        const exist_bno = {};
        const symbols = this;
        // 检查重复并建立索引
        symbols.list.forEach(symbol => {
            const name = symbol.name;
            try {
                if (INTEGER_PREFIX.includes(symbol.block_name)) { // OB DB FB FC SFB SFC UDT 自动分配块号
                    symbol.block_no = symbols[symbol.block_name + '_list'].push(symbol.block_no);
                    symbol.address = symbol.block_name + symbol.block_no;
                } else if (S7MEM_PREFIX.includes(symbol.block_name)) {
                    // list 为 PIA_list、PQA_list、MA_list、IA_list、QA_list 之一
                    const prefix = ['PI', 'PQ', 'M', 'I', 'Q'].find(prefix => symbol.block_name.startsWith(prefix));
                    const area_list = symbols[prefix + 'A_list'];
                    const s7addr = symbol.block_no == null
                        ? null // Area 自动分配地址
                        : foct2S7addr(symbol.block_no, symbol.block_bit);
                    const size = area_size[symbol.block_name];
                    const final_s7addr = area_list.push(s7addr, size);
                    const decimal_places = symbol.type === 'BOOL' ? 1 : 0;
                    symbol.address = symbol.block_name + final_s7addr.toFixed(decimal_places);
                    if (s7addr == null) {
                        const [block_no, block_bit] = s7addr2foct(final_s7addr);
                        symbol.block_no = block_no;
                        symbol.block_bit = block_bit;
                    }
                } else if (exist_bno[symbol.address]) { // 其它情况下检查是否重复
                    throw new RangeError(`重复地址 Duplicate address ${name} ${symbol.address}!`);
                } else { // 不重复则标识该地址已存在
                    exist_bno[symbol.address] = true;
                }
            } catch (e) {
                if (e instanceof TypeError) {
                    throw new TypeError(e.message, { cause: e });
                } else if (e instanceof HLError || e instanceof RangeError) {
                    throw_symbol_conflict(
                        `符号地址错误 Symbol address error: ${e.message}`,
                        symbol,
                        symbols.list.find(sym => symbol !== sym && sym.address === symbol.address)
                    );
                }
                console.log(e.message);
            }
            // 补全类型
            symbol.complete_type();
        });
    }

    constructor() {
        super();
        this.#buildin = BUILDIN_SYMBOLS.documents.map(doc =>
            [
                ...get_Seq(doc, 'symbols'),
                ...get_Seq(doc, 'reference_symbols')
            ].map(
                symbol => symbol.items[0].value
            )
        ).flat();
        this.setMaxListeners(1024);
        this.on('finished', this.build_symbols);
    }
}

/**
 * 将 原始符号 转换后加入到 CPU.symbols 中
 * @date 2022-11-09
 * @param {import('yaml').Document} document - 符号所在的文档
 * @param {import('yaml').Node|string[]} symbol_raw - 符号的输入值
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
    // 生成符号
    const symbol = new S7Symbol(source);
    symbol.symbols = symbols;

    const name = symbol.name;
    const ref = symbols.get(name);
    if (symbols.is_buildin(name) && ref) {
        // 已存在该内置符号则应用新地址
        ref.address = symbol.address;
    } else if (ref) {
        // 不允许符号名称重复
        throw_symbol_conflict(`符号"${name}"名称重复!`, symbol, symbols.get(name));
    } else {
        // 新符号则保存
        symbols.add(name, symbol);
    }

    return ref ?? symbol;
}

/**
 * 对指定的符号定义列表解析并返回S7符号列表
 * 应只用于单纯增加某个CPU的符号
 * 具体配置里的符号，应当用make_prop_symbolic。
 * @date 2022-07-05
 * @param {import('yaml').Document} document
 * @param {String[]|import('yaml').YAMLSeq} symbol_list
 * @returns {S7Symbol[]>}
 */
export function add_symbols(document, symbol_list) {
    if (Array.isArray(symbol_list)) {
        return symbol_list.map(symbol_raw => add_symbol(document, symbol_raw));
    }
    return [];
}

function isS7Express(str) {
    if (typeof str !== 'string') return false;
    str = str.replace(/"[^"]+"/g, '');
    return /,|\+|-|\*|\/|\bnot\b|\band\b|\bor\b|\bxor\b|\bdiv\b|\bmod\b|\bshl\b|\bshr\b/i.test(str);
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
    console.error(`\n\nsymbol type incompatible! 符号类型不兼容!`);
    console.error(`current symbol information 当前符号信息: ${get_msg(symbol)}
        错误: ${type}`
    );
    process.exit(10);
}

function apply_default_force(symbol, options) {
    const force_type = options?.force?.type;
    if (typeof force_type === 'string') {
        // 强制指定类型，完全忽略用户的定义
        if (symbol.check_type_compatibility(force_type)) {
            symbol.type = force_type;
            if (symbol.userDefinedType && symbol.userDefinedType != force_type) {
                WRONGTYPESYMBOLS.add(symbol);
            }
        } else {
            throw_type_incompatible(symbol, force_type);
        }
    } else {
        // 默认类型
        symbol.type ??= options?.default?.type;
    }
    const force_comment = options?.force?.comment;
    if (typeof force_comment === 'string') {
        // 强制指定注释，完全忽略用户的定义
        symbol.comment = force_comment;
    } else if (symbol.comment == '') {
        // 默认注释
        symbol.comment = options?.default?.comment;
    }
}

export async function make_s7_expression(value, infos = {}) {
    // 默认允许 符号定义 符号连接 S7表达式 未定义
    const disallow_null = infos.disallow_null === true;
    const disallow_s7express = infos.disallow_s7express === true;
    const allow_symbol_def = infos.disallow_symbol_def !== true;
    const allow_symbol_link = infos.disallow_symbol_link !== true;
    const { document, s7_expr_desc } = infos;
    const symbols = document.CPU.symbols;
    if (value == undefined) {
        if (disallow_null) throw new Error('不允许空值');
        return value;
    }

    if ((Array.isArray(value) || isSeq(value)) && allow_symbol_def) {
        // 如是符号定义，则返回转换后的符号对象
        const symbol = add_symbol(document, value);
        apply_default_force(symbol, infos);
        return symbol;
    }

    function do_s7expr() {
        if (disallow_s7express) throw new SyntaxError('不允许非符号 S7 表达式');
        const s7expr = ref(value);
        if (!s7expr) throw new SyntaxError('非有效的 S7 表达式');
        NON_SYMBOLS.push({ value, desc: s7_expr_desc });
        return s7expr;
    }

    if (isString(value)) value = value.value;

    if (typeof value === 'string' && allow_symbol_link) {
        // 如是引用有效，则返回引用符号。
        const symbol = symbols.get(value);
        if (symbol) {
            apply_default_force(symbol, infos); // { force, default}
            return symbol;
        }

        // 如果引用无效，进行异步赋值，因为此时全部符号尚未完全加载完。
        // 符号完成时将赋值为最终符号或S7表达式对象
        const promise = new Promise((resolve, reject) => {
            const fn = () => resolve(do_s7expr());
            symbols.on(`${value}_added`, (symbol) => {
                // 如是引用存在，则返回引用符号。
                symbols.removeListener('finished', fn);
                resolve(symbol);
            });
            symbols.on('finished', fn);
        });
        SYMBOL_PROMISES.push(promise);
        return promise;
    } else {
        return do_s7expr(); // 获得S7表达式
    }
}

const SYMN_LEN = 23;
const NAME_LEN = 4;
const NO_LEN = 5;
const BLANK_COMMENT_LEN = 80;
/**
 * 生成 step7 符号源码行，固定长度，其中每个字段的表示为{字段说明 字符数}
 * 
 * * `126,{symname23} {block_name_str4}{block_no_str5}{block_bit_str2} {type_str4}{type_no_str5} {comment80}`
 * 
 * @date 2022-11-09
 * @param {S7Symbol} symbol
 * @returns {string}
 */
function get_step7_symbol({ name: symname, type, block_name, block_no, block_bit, type_name, type_no = '', comment, exportable }) {
    if (!exportable) return null;
    const name = pad_right(symname, SYMN_LEN);
    const address = pad_right(block_name, NAME_LEN)
        + pad_left(block_no, NO_LEN)
        + (type === 'BOOL' ? '.' + block_bit : '  ');
    const type_str = pad_right(type_name, NAME_LEN) + pad_left(type_no, NO_LEN);
    const cm = pad_right(comment, BLANK_COMMENT_LEN);
    const line = `126,${name} ${address} ${type_str} ${cm}`;
    return { name, address, line };
}

/**
 * 生成 portal 符号源码行，其中每个字段用引号包裹，引号中替换为实际值
 * 
 * * `"name","address","type","accessiable","visiable","retain","comment","supervision","writable"`
 * 
 * @date 2022-11-09
 * @param {S7Symbol} symbol
 * @returns {string}
 */
function get_portal_symbol({ name, type, address, block_name, comment, exportable }) {
    if (!exportable) return null;
    if (INTEGER_PREFIX.includes(block_name)) return null; // 不生成 OB, FB, FC, SFB, SFC, UDT 的符号
    const line = `"${name}","%${address}","${type}","True","True","False","${comment}","","True"`;
    return { name, address, line };
}

const template = `{{#for symbol in symbol_list}}{{symbol.line}}
{{#endfor symbol}}`;

export function gen_symbols(CPU_list) {
    return {
        rules: CPU_list.map(CPU => {
            const symbol_list = CPU.symbols.list
                .map(CPU.platform === "portal" ? get_portal_symbol : get_step7_symbol)
                .filter(symbol => symbol !== null) // 跳过被筛除的符号
                .sort((a, b) => compare_str(a.name, b.name))
                .sort((a, b) => compare_str(a.address, b.address));
            return {
                "name": `${CPU.output_dir}/symbols.${CPU.platform === "portal" ? 'sdf' : 'asc'}`,
                "tags": { symbol_list }
            };
        }),
        template,
    };
}

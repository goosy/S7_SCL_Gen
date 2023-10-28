import assert from 'assert/strict';
import { IncHLError, compare_str } from "./util.js";
import { pad_left, pad_right } from "./value.js";
import { GCL, isString } from './gcl.js';
import { isSeq } from 'yaml';
import { posix } from 'path';
import { fileURLToPath } from 'url';

export const BUILDIN_SYMBOLS = new GCL(); // Initialized by converter.js
await BUILDIN_SYMBOLS.load(posix.join(
    fileURLToPath(import.meta.url).replace(/\\/g, '/'),
    '../symbols_buildin.yaml'
));

export const NONSYMBOLS = [];
export const LAZYASSIGN_LIST = [];

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

// equal area_size = { M: 0.1, I: 0.1, Q: 0.1, MB: 1, ... PQD: 4};
const area_size = Object.fromEntries([
    ...BIT_PREFIX.map(prefix => [prefix, 0.1]),
    ...BYTE_PREFIX.map(prefix => [prefix, 1.0]),
    ...WORD_PREFIX.map(prefix => [prefix, 2.0]),
    ...DWORD_PREFIX.map(prefix => [prefix, 4.0]),
]);

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
function throw_symbol_error(message, curr_symbol, prev_symbol) {
    const prev_msg = prev_symbol ? `previous symbol position 之前符号位置: ${get_msg(prev_symbol)}\n` : '';
    const curr_msg = curr_symbol ? `current symbol position 当前符号位置: ${get_msg(curr_symbol)}\n` : '';
    console.error(`${message}\n${prev_msg}${curr_msg}`);
    process.exit(10);
}

class S7Symbol {
    value;
    block_name;
    block_no;
    block_bit;
    type_name;
    type_no;
    /**
     * @type {Source}
     */
    source = {};
    CPU;
    #symbol_error() {
        return new SyntaxError(`symbol define ${this.source.raw} is wrong!`);
    }
    // regexp = /^(OB|FB|FC||SFB|SFC|UDT|DB|MD|ID|PID|QD|PQD|MW|IW|PIW|QW|PQW|MB|IB|PIB|QB|PQB|M|I|Q)(\d+|\+)(\.(\d))?$/
    s7addr_reg = new RegExp(`^(${[...INTEGER_PREFIX, ...S7MEM_PREFIX].join('|')})(\\d+|\\+)(\\.(\\d))?$`);
    parse_s7addr(address) {
        const [, block_name, block_no, , block_bit = 0] = this.s7addr_reg.exec(address.toUpperCase()) ?? [];
        if (!block_name || !block_no) throw this.#symbol_error();
        return [block_name, block_no, block_bit];
    }

    _name;
    get name() {
        return this._name
    }
    set name(name) {
        assert.equal(typeof name, 'string', this.#symbol_error());
        this._name = name;
    }

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

    _type;
    get type() {
        return this._type;
    }
    set type(type) {
        if (typeof type === "string") {
            const UC_type = type.toUpperCase();
            if (COMMON_TYPE.includes(UC_type)) {
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
        this._type = type;
        // const [type_name, type_no] = parse_s7addr(type);
    }
    complete_type() {
        if (INDEPENDENT_PREFIX.includes(this.block_name) || this.type == null) {
            this.type = this.name;
        }
        if (COMMON_TYPE.includes(this.type)) {
            this.type_name = this.type;
            this.type_no = '';
        } else {
            const type_block = this.CPU.symbols_dict[this.type];
            if (!type_block) {
                console.error(`\n\nsymbol ERROR!!! 符号错误！！！`);
                console.error(`type ${this.type} is required, but not defined`);
                console.error(`需要符号类型${this.type}，但是该类型未定义`);
                console.error(`current symbol information 当前符号信息: ${get_msg(this)}`);
                process.exit(10);
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

    constructor(raw) {
        this.source.raw = raw;
        this.name = raw[0];
        this.address = raw[1];
        this.type = raw[2];
        this.comment = raw[3];
        this.value = `"${this.name}"`;
    }
    static from(raw) {
        if (!Array.isArray(raw)) return raw;
        raw[1] = raw[1]?.toUpperCase();
        return new S7Symbol(raw);
    }
}

/**
 * 将 原始符号 转换后加入到 CPU.symbols_dict 中
 * @date 2022-11-09
 * @param {import('yaml').Document} document - 符号所在的文档
 * @param {import('yaml').Node|string[]} symbol_raw - 符号的输入值
 * @returns {S7Symbol}
 */
export function add_symbol(document, symbol_raw) {
    const is_Seq = isSeq(symbol_raw);
    const symbol_definition = is_Seq ? JSON.parse(symbol_raw) : symbol_raw;
    if (!Array.isArray(symbol_definition)) throw_symbol_error(`符号必须是一个定义正确数组！ 原始值:"${symbol_definition}"`);
    const CPU = document.CPU;
    const symbols_dict = CPU.symbols_dict;
    // 生成符号
    const symbol = new S7Symbol(symbol_definition);
    // 保存源信息
    symbol.source.document = document;
    symbol.source.range = is_Seq ? symbol_raw.range : [0, 0, 0];
    symbol.CPU = CPU;

    const name = symbol.name;
    const is_buildin = CPU.buildin_symbols.includes(name);
    const ref = symbols_dict[name];
    if (is_buildin && ref) {
        // 已存在该内置符号则应用新地址
        ref.address = symbol.address;
    } else if (ref) {
        // 不允许符号名称重复
        throw_symbol_error(`符号"${name}"名称重复!`, symbol, symbols_dict[name]);
    } else {
        // 新符号则保存
        symbols_dict[name] = symbol;
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

function ref(item) {
    let ret = null;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        ret = {
            value: item,
            type: 'ref',
            toString() {
                return this.value.toString();
            }
        };
    }
    return ret;
}

function check_type_compatibility(symbol, type) {
    // @TODO
    return true;
}
function apply_default_force(symbol, options) {
    const force_type = options?.force?.type;
    if (typeof force_type === 'string') {
        // 强制指定类型，完全忽略用户的定义
        if (check_type_compatibility(symbol, force_type)) symbol.type = force_type;
        else throw new Error('符号类型不兼容');
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

export function make_s7express(obj, prop, value, document, options = {}) {
    const comment = options.comment;
    function s7express(value) {
        if (value === undefined || !options.s7express) return undefined;
        const ret = ref(value);
        if (!ret) throw new Error('非有效项的值');  // 非表达式报错
        // 数字或布尔值返回引用对象
        NONSYMBOLS.push({ prop, value, comment });
        return ret;
    }
    function get_linked_symbol(name) {
        const symbol = document.CPU.symbols_dict[name];
        if (symbol) apply_default_force(symbol, options);
        return symbol;
    }
    options.definition ??= true; // 默认允许符号定义
    options.link ??= true; // 默认允许符号引用

    if ((Array.isArray(value) || isSeq(value)) && options.definition) {
        // 如是符号定义，则返回转换后的符号对象
        const symbol = add_symbol(document, value, options);
        apply_default_force(symbol, options);
        obj[prop] = symbol;
        return;
    }

    if (isString(value)) value = value.value;
    if (typeof value === 'string' && options.link) {
        // 如是引用有效，则返回引用符号。
        const symbol = get_linked_symbol(value);
        if (symbol) {
            obj[prop] = symbol;
            return;
        }

        // 如果引用不有效，返回惰性赋值,
        // 因为全部符号尚未完全加载完
        // 下次调用时将赋值为最终符号或S7表达式对象
        LAZYASSIGN_LIST.push(() => {
            const symbol = get_linked_symbol(value);
            if (symbol) {
                // 如是引用存在，则返回引用符号。
                symbol.complete_type();
                obj[prop] = symbol;
            } else {
                obj[prop] = s7express(value);
            }
        });
        return;
    }
    obj[prop] = s7express(value);
}
export function make_prop_symbolic(obj, prop, document, options = {}) {
    const value = obj[prop];
    options.comment = obj.comment ?? '';
    options.link = true;
    options.s7express = true;
    if (value != null) make_s7express(obj, prop, value, document, options);
}

// 第二遍扫描，检查并补全符号表
// 主要是检查或生成最终符号块号、补全类型等
export function build_symbols(CPU) {
    const exist_bno = {};
    const symbols_dict = CPU.symbols_dict;
    const list = Object.values(symbols_dict);
    // 检查重复并建立索引
    list.forEach(
        /**
         * @param {Symbol} symbol
         */
        symbol => {
            const name = symbol.name;
            try {
                if (INTEGER_PREFIX.includes(symbol.block_name)) { // OB DB FB FC SFB SFC UDT 自动分配块号
                    symbol.block_no = CPU[symbol.block_name + '_list'].push(symbol.block_no);
                    symbol.address = symbol.block_name + symbol.block_no;
                } else if (S7MEM_PREFIX.includes(symbol.block_name)) { // Area 自动分配地址
                    const s7addr = [symbol.block_no, symbol.block_bit];
                    // list 为 CPU.PIA_list、CPU.PQA_list、CPU.MA_list、CPU.IA_list、CPU.QA_list 之一
                    const area_list = CPU[['PI', 'PQ', 'M', 'I', 'Q'].find(prefix => symbol.block_name.startsWith(prefix)) + 'A_list'];
                    const address = area_list.push(s7addr, area_size[symbol.block_name]);
                    symbol.block_no = address[0];
                    symbol.block_bit = address[1];
                    symbol.address = symbol.block_name + symbol.block_no + (symbol.type === 'BOOL' ? '.' + symbol.block_bit : '');
                } else if (exist_bno[symbol.address]) { // 其它情况下检查是否重复
                    throw new RangeError(`重复地址 ${name} ${symbol.address}!`)
                } else { // 不重复则标识该地址已存在
                    exist_bno[symbol.address] = true;
                }
            } catch (e) {
                if (e instanceof TypeError) {
                    throw new TypeError(e.message, { cause: e });
                } else if (e instanceof IncHLError || e instanceof RangeError) {
                    throw_symbol_error(
                        `符号地址错误: ${e.message}`,
                        symbol,
                        list.find(sym => symbol !== sym && sym.address === symbol.address)
                    );
                }
                console.log(e.message);
            }
            symbols_dict[name] = symbol;
        }
    );
    // 补全类型
    list.forEach(symbol => symbol.complete_type());
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
 * @param {Symbol} symbol
 * @returns {string}
 */
function get_step7_symbol({ name: symname, type, block_name, block_no, block_bit, type_name, type_no = '', comment }) {
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
 * @param {Symbol} symbol
 * @returns {string}
 */
function get_portal_symbol({ name, type, address, block_name, comment }) {
    if (INTEGER_PREFIX.includes(block_name)) return null; // 不生成 OB, FB, FC, SFB, SFC, UDT 的符号
    const line = `"${name}","%${address}","${type}","True","True","False","${comment}","","True"`;
    return { name, address, line };
}

const template = `{{#for symbol in symbol_list}}{{symbol.line}}
{{#endfor symbol}}`;

export function gen_symbols(CPU_list) {
    return {
        rules: CPU_list.map(CPU => {
            const symbol_list = Object.values(CPU.symbols_dict)
                .map(CPU.platform === "portal" ? get_portal_symbol : get_step7_symbol)
                .filter(symbol => symbol) // 省略 portal 的 OB, FB, FC, SFB, SFC, UDT
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

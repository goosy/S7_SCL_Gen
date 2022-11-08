import assert from 'assert/strict';
import { IncHLError, lazyassign, str_padding_left, str_padding_right } from "./util.js";
import { isSeq, YAMLSeq } from 'yaml';
import { GCL } from './gcl.js';
import { posix } from 'path';
import { fileURLToPath } from 'url';

export const BUILDIN_SYMBOLS = new GCL(); // Initialized by converter.js
await BUILDIN_SYMBOLS.load(posix.join(fileURLToPath(import.meta.url).replace(/\\/g, '/'), '../symbols_buildin.yaml'));

// FB|FC|DB|UDT|MD|PID|ID|PQD|QD|MW|PIW|IW|PQW|QW|MB|PIB|IB|PQB|QB|M|I|Q
const INDEPENDENT_PREFIX = ['OB', 'FB', 'FC', 'UDT'];
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

function throw_symbol_error(message, curr_symbol, prev_symbol) {
    const get_msg = symbol => {
        const doc = symbol.source.document;
        const gcl = doc.gcl;
        if (gcl) {
            const { ln, col, code } = gcl.get_coorinfo(...symbol.source.range);
            return `
            文件:${gcl.file}
            文档:${doc.CPU}-${doc.type}
            符号:${symbol.name}
            行:${ln}
            列:${col}
            代码:${code}`;
        }
        return `内置符号 symbol:${symbol.name}`
    };
    const prev_msg = prev_symbol ? `之前符号位置: ${get_msg(prev_symbol)}\n` : '';
    const curr_msg = curr_symbol ? `当前符号位置: ${get_msg(curr_symbol)}\n` : '';
    console.error(`${message}\n${prev_msg}${curr_msg}`);
    process.exit(10);
}

function parse(raw, default_type) {
    // 非 array 不处理
    if (!Array.isArray(raw)) return raw;
    const
        name = raw[0],
        addr = raw[1]?.toUpperCase(),
        comment = raw[3];
    const symbol_error = new SyntaxError(`${raw} is wrong!`);
    assert.equal(typeof name, 'string', symbol_error);
    assert.equal(typeof addr, 'string', symbol_error);
    let type = raw[2] ?? default_type;
    if (typeof type === "string") {
        const UC = type.toUpperCase();
        if (COMMON_TYPE.includes(UC)) {
            type = UC;
        }
    } else {
        type = null;
    }
    if (type === addr) type = name;
    // regexp = /^(OB|FB|FC|UDT|DB|MD|ID|PID|QD|PQD|MW|IW|PIW|QW|PQW|MB|IB|PIB|QB|PQB|M|I|Q)(\d+|\+)(\.(\d))?$/
    const prefix_str = [...INTEGER_PREFIX, ...S7MEM_PREFIX].join('|');
    const reg = new RegExp(`^(${prefix_str})(\\d+|\\+)(\\.(\\d))?$`);
    let [, block_name, block_no, , block_bit = 0] = reg.exec(addr.toUpperCase()) ?? [];
    if (!block_name || !block_no) return raw;
    if (INDEPENDENT_PREFIX.includes(block_name)) {
        // FB FC UDT 的类型是自己
        type = name;
    }
    if (type) {
        // type 必须是字符串
        assert.equal(typeof type, 'string', symbol_error);
    } else if (block_name === 'DB') {
        // DB的默认类型是自己
        type = name;
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
    let [, type_name, type_no] = reg.exec(type.toUpperCase()) ?? [type];
    const value = `"${name}"`;
    const source = { raw };
    return { name, addr, type, value, block_name, block_no, block_bit, type_name, type_no, comment, source };
}

function check_buildin_and_modify(CPU, symbol) {
    const symbols_dict = CPU.symbols_dict;
    if (!CPU.buildin_symbols.includes(symbol.name)) return false;
    const ref = symbols_dict[symbol.name];
    if (!ref) return false;
    // modify address
    ref.addr = symbol.addr;
    ref.block_no = symbol.block_no;
    ref.block_bit = symbol.block_bit;
    return true;
}

export function add_symbol(CPU, symbol_raw, options = {}) {
    const is_AST = isSeq(symbol_raw);
    const symbols_dict = CPU.symbols_dict;
    const default_type = typeof options.default_type === 'string' ? options.default_type : null;
    const symbol_definition = is_AST ? JSON.parse(symbol_raw) : symbol_raw;
    const force_type = options.force_type;
    if (typeof force_type === 'string') {
        symbol_definition[2] = force_type;
    }
    const symbol = parse(symbol_definition, default_type);

    // 非有效符号
    if (!symbol.source) throw_symbol_error(`符号必须是一个定义正确数组！ 原始值:"${symbol_definition}"`);

    // 内置符号则应用新地址
    const is_buildin = check_buildin_and_modify(CPU, symbol);

    // 保存源信息
    symbol.source.document = options.document;
    symbol.source.range = is_AST ? symbol_raw.range : [0, 0, 0];

    // 不允许重复
    if (!is_buildin && symbols_dict[symbol.name]) {
        throw_symbol_error(`符号"${symbol.name}"名称重复!`, symbol, symbols_dict[symbol.name]);
    }
    // 新符号则保存
    if (!is_buildin) {
        symbols_dict[symbol.name] = symbol;
    }
    return symbol;
}

/**
 * 对指定的符号定义列表解析并返回S7符号列表
 * @date 2022-07-05
 * @param {CPU} CPU
 * @param {String[]|YAMLSeq} symbol_list
 * @param {Object} options
 * @returns {Symbol[]}
 */
export function add_symbols(CPU, symbol_list, options = {}) {
    if (isSeq(symbol_list)) {
        return symbol_list.items.map(symbol_node => add_symbol(CPU, symbol_node, options));
    } else if (Array.isArray(symbol_list)) {
        return symbol_list.map(symbol_raw => add_symbol(CPU, symbol_raw, options));
    }
    return [];
}

function ref(item) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        return { value: item, type: 'ref' };
    }
    return item;
}

export function make_prop_symbolic(obj, prop, CPU, options = {}) {
    const value = obj[prop];
    if (Array.isArray(value)) {
        // 如是数组，则返回符号
        obj[prop] = add_symbol(CPU, value, options);
    } else if (typeof value === 'string') {
        // 如是字符串，则返回惰性赋值符号函数,因为全部符号尚未加载完。
        // 下次调用时将赋值为最终符号或字串值引用对象
        // TODO: 强制类型
        lazyassign(obj, prop, () => CPU.symbols_dict[value] ?? ref(value));
    } else {
        // 数字或布尔值返回引用对象
        // 其它直接值返回本身
        obj[prop] = ref(value);
    }
}

// 第二遍扫描，检查并补全符号表
export function build_symbols(CPU) {
    const exist_bno = {};
    const symbols_dict = CPU.symbols_dict;
    const list = Object.values(symbols_dict);
    // 检查重复并建立索引
    list.forEach(symbol => {
        const name = symbol.name;
        try {
            if (INTEGER_PREFIX.includes(symbol.block_name)) { // OB DB FB FC UDT 自动分配块号
                if (symbol.block_no === '+') symbol.block_no = null;
                else symbol.block_no = parseInt(symbol.block_no); //取整
                symbol.block_bit = "";
                symbol.block_no = CPU[symbol.block_name + '_list'].push(symbol.block_no);
                symbol.addr = symbol.block_name + symbol.block_no;
            } else if (S7MEM_PREFIX.includes(symbol.block_name)) { // Area 自动分配地址
                const s7addr = symbol.block_no === '+' ? [null, 0] : [parseInt(symbol.block_no), parseInt(symbol.block_bit)];
                // list 为 CPU.PIA_list、CPU.PQA_list、CPU.MA_list、CPU.IA_list、CPU.QA_list 之一
                const area_list = CPU[['PI', 'PQ', 'M', 'I', 'Q'].find(prefix => symbol.block_name.startsWith(prefix)) + 'A_list'];
                const addr = area_list.push(s7addr, area_size[symbol.block_name]);
                symbol.block_no = addr[0];
                symbol.block_bit = addr[1];
                symbol.addr = symbol.block_name + symbol.block_no + (symbol.type === 'BOOL' ? '.' + symbol.block_bit : '');
            } else if (exist_bno[symbol.addr]) { // 其它情况下检查是否重复
                throw new RangeError(`重复地址 ${name} ${symbol.addr}!`)
            } else { // 不重复则标识该地址已存在
                exist_bno[symbol.addr] = true;
            }
        } catch (e) {
            if (e instanceof TypeError) {
                throw new TypeError(e.message, { cause: e });
            } else if (e instanceof IncHLError || e instanceof RangeError) {
                throw_symbol_error(
                    `符号地址错误: ${e.message}`,
                    symbol,
                    list.find(sym => symbol !== sym && sym.addr === symbol.addr)
                );
            }
            console.log(e.message);
        }
        symbols_dict[name] = symbol;
    });
    // 补全类型
    list.forEach(symbol => {
        if (INDEPENDENT_PREFIX.includes(symbol.block_name) || symbol.type == null) {
            symbol.type = symbol.name;
        }
        if (COMMON_TYPE.includes(symbol.type)) {
            symbol.type_name = symbol.type;
            symbol.type_no = '';
        } else {
            const type_block = symbols_dict[symbol.type];
            if (!type_block) throw new Error(`${symbol.type} is required, but not defined`);
            symbol.type_name ??= type_block.block_name;
            symbol.type_no ??= type_block.block_no;
        }
    });
}

const SYMN_LEN = 23;
const NAME_LEN = 4;
const NO_LEN = 5;
const BLANK_COMMENT_LEN = 80;
function get_S7_symbol({ name, type, block_name, block_no, block_bit, type_name, type_no = '', comment }) {
    const symname = str_padding_right(name, SYMN_LEN);
    const block_name_str = str_padding_right(block_name, NAME_LEN);
    const block_no_str = str_padding_left(block_no, NO_LEN);
    const block_bit_str = type === 'BOOL' ? '.' + block_bit : '  ';
    const type_len = type_no === '' ? NAME_LEN + NO_LEN : NAME_LEN;
    const type_str = str_padding_right(type_name, type_len);
    const type_no_str = type_no === '' ? '' : str_padding_left(type_no, NO_LEN);
    const cm = str_padding_right(comment ?? '', BLANK_COMMENT_LEN);
    return `126,${symname} ${block_name_str}${block_no_str}${block_bit_str} ${type_str}${type_no_str} ${cm}`;
}

const template = `{{#for sym in symbol_list}}{{sym}}
{{#endfor sym}}`;

export function gen_symbols(CPUs) {
    const rules = [];
    for (const CPU of Object.values(CPUs)) {
        const symbol_list = Object.values(CPU.symbols_dict).map(get_S7_symbol);
        if (symbol_list.length) rules.push({
            "name": `${CPU.output_dir}/symbols.asc`,
            "tags": { symbol_list }
        });
    };
    return { rules, template };
}

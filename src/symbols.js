import { str_padding_left, str_padding_right } from "./str_padding.js";
const common_type = ['BOOL', 'BYTE', 'INT', 'WORD', 'REAL'];

export function add_symbol(symbols, symbol_raw, default_type) {
    // 返回引用符号
    if (Object.prototype.toString.call(symbol_raw) === '[object Object]') {
        const ref_name = symbol_raw.buildin ?? symbol_raw.ref;
        if (ref_name) {
            const ref = symbols.find(symbol => symbol.name === ref_name);
            // 修改内置符号
            if (ref && symbol_raw.buildin) {
                ref.addr = symbol_raw.addr;
                ref.comment = symbol_raw.comment;
            }
            return ref ?? symbol_raw;
        }
    }
    // todo 非 array 不处理
    if (!Array.isArray(symbol_raw)) return symbol_raw;

    const
        name = symbol_raw[0],
        addr = symbol_raw[1],
        comment = symbol_raw[3];
    let type = symbol_raw[2] ?? default_type;
    if (type === addr) type = name;
    const reg = /^(MW|MD|M|FB|FC|DB|PIW|IW|I|PQW|QW|Q)(\d+|\+)(\.(\d))?$/;
    if (!typeof addr === 'string') throw new Error(`${symbol_raw} is wrong!`);
    let [, block_name, block_no, , block_bit = 0] = reg.exec(addr.toUpperCase()) ?? [];
    if (!block_name || !block_no) return symbol_raw;
    if (block_name === 'FB' || block_name === 'FC') {
        // FB FC 的类型是自己
        type = name;
    }
    if (!type && block_name === 'DB') {
        // DB的默认类型是自己
        type = name;
    }
    if (!type && /^MD$/.test(block_name)) {
        // MD 的默认类型是 DWORD
        type = 'DWORD';
    }
    if (!type && /^MW|PIW$/.test(block_name)) {
        // MW PIW 的默认类型是 WORD
        type = 'WORD';
    }
    if (!type && /^I|Q$/.test(block_name)) {
        // I Q 的默认类型是 BOOL
        type = 'BOOL';
    }
    let [, type_name, type_no] = reg.exec(type.toUpperCase()) ?? [type];
    const value = `"${name}"`;
    const symbol = { name, addr, type, value, block_name, block_no, block_bit, type_name, type_no, comment };
    symbols.push(symbol);
    return symbol;
}
export function add_symbols(symbols, symbol_raw_list) {
    symbol_raw_list.forEach(symbol_raw => add_symbol(symbols, symbol_raw));
}
const MA_size = {
    M: 0.1,
    MB: 1.0,
    MW: 2.0,
    MD: 4.0
}
// 检查并补全符号表
export function rebuild_symbols(CPU) {
    const exist_name = {};
    const exist_bno = {};
    const { MA_list, symbols } = CPU;
    // 检查重复并建立索引
    symbols.forEach(symbol => {
        const name = symbol.name;
        if (exist_name[name]) throw new Error(`存在重复的符号名称 ${name}!`)
        exist_name[name] = true;
        if (['DB', 'FB', 'FC'].includes(symbol.block_name)) { // DB FB FC 自动分配块号
            if (symbol.block_no === '+') symbol.block_no = null;
            else symbol.block_no = parseInt(symbol.block_no); //取整
            symbol.block_bit = "";
            symbol.block_no = CPU[symbol.block_name + '_list'].push(symbol.block_no);
            symbol.addr = symbol.block_name + symbol.block_no;
        } else if (['MD', 'MW', 'M'].includes(symbol.block_name)) { // MA 自动分配地址
            if (symbol.block_no === '+') {
                symbol.block_no = null;
                symbol.block_bit = 0;
            } else {
                symbol.block_no = parseInt(symbol.block_no);
                symbol.block_bit = parseInt(symbol.block_bit);
            }
            const addr = MA_list.push([symbol.block_no, symbol.block_bit], MA_size[symbol.block_name]);
            symbol.block_no = addr[0];
            symbol.block_bit = addr[1];

        } else if (exist_bno[symbol.addr]) { // 其它情况下检查是否重复
            throw new Error(`存在重复的地址 ${name} ${symbol.addr}!`)
        } else { // 不重复则标识该地址已存在
            exist_bno[symbol.addr] = true;
        }
        symbols[name] = symbol;
    });
    // 补全类型
    symbols.forEach(symbol => {
        if (symbol.block_name == "OB" || symbol.block_name == "FB" || symbol.block_name == "FC" || symbol.type == null) {
            symbol.type = symbol.name;
        }
        if (common_type.includes(symbol.type)) {
            symbol.type_name = symbol.type;
            symbol.type_no = '';
        } else {
            const type_block = symbols[symbol.type];
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

function get_symbol({ name, block_name, block_no, block_bit, type_name, type_no = '', comment }) {
    const symname = str_padding_right(name, SYMN_LEN);
    const block_name_str = str_padding_right(block_name, NAME_LEN);
    const block_no_str = str_padding_left(block_no, NO_LEN);
    const block_bit_str = block_bit ? '.' + block_bit : '  ';
    const type_str = str_padding_right(type_name, NAME_LEN);
    const type_no_str = str_padding_left(type_no, NO_LEN);
    const cm = str_padding_right(comment ?? '', BLANK_COMMENT_LEN);
    return `126,${symname} ${block_name_str}${block_no_str}${block_bit_str} ${type_str}${type_no_str} ${cm}`;
}

const template = `{{#for sym in symbol_list}}{{sym}}
{{#endfor sym}}`;
export function gen_symbol(CPUs) {
    const rules = [];
    Object.values(CPUs).forEach(CPU => {
        const symbol_list = CPU.symbols.map(get_symbol);
        const output_dir = CPU.output_dir;
        rules.push({
            "name": `${output_dir}/symbols.asc`,
            "tags": { symbol_list }
        })
    });
    return { rules, template }
}

import { IncHLError, lazyassign, str_padding_left, str_padding_right } from "./util.js";
import { trace_info } from './trace_info.js'

export const buildin_symbols = [];//加载转换器后自动重建

const common_type = ['BOOL', 'BYTE', 'INT', 'WORD', 'DWORD', 'DINT', 'REAL'];

function throw_symbol_error(message, curr_symbol, prev_symbol) {
    const get_msg = symbol => {
        const sInfo = trace_info.get_symbol(symbol);
        return `${sInfo.CPU}:${sInfo.type} symbol:[${symbol.raw}] (文件"${sInfo.filename}"第${sInfo.doc_index}个文档)`;
    };
    const prev_msg = prev_symbol ? `之前: ${get_msg(prev_symbol)}\n` : '';
    const curr_msg = curr_symbol ? `当前: ${get_msg(curr_symbol)}\n` : '';
    console.error(`${message}\n${prev_msg}${curr_msg}`);
    process.exit(10);
}

function parse(raw, default_type) {
    // todo 非 array 不处理
    if (!Array.isArray(raw)) return raw;
    const
        name = raw[0],
        addr = raw[1]?.toUpperCase(),
        comment = raw[3];
    if (typeof addr !== 'string' || typeof name !== 'string') {
        throw new Error(`${raw} is wrong!`);
    }
    let type = raw[2] ?? default_type;
    if (typeof type === "string") {
        const UC = type.toUpperCase();
        if (common_type.includes(UC)) {
            type = UC;
        }
    } else {
        type = null;
    }
    if (type === addr) type = name;
    const reg = /^(MW|MD|M|FB|FC|DB|PIW|IW|I|PQW|QW|Q|UDT)(\d+|\+)(\.(\d))?$/;
    let [, block_name, block_no, , block_bit = 0] = reg.exec(addr.toUpperCase()) ?? [];
    if (!block_name || !block_no) return raw;
    if (block_name === 'FB' || block_name === 'FC' || block_name === 'UDT') {
        // FB FC UDT 的类型是自己
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
    if (!type && /^(MW|IW|PIW|QW|PQW)$/.test(block_name)) {
        // MW PIW 的默认类型是 WORD
        type = 'WORD';
    }
    if (!type && /^(I|Q|M)$/.test(block_name)) {
        // I Q 的默认类型是 BOOL
        type = 'BOOL';
    }
    let [, type_name, type_no] = reg.exec(type.toUpperCase()) ?? [type];
    const value = `"${name}"`;
    return { name, addr, type, value, block_name, block_no, block_bit, type_name, type_no, comment, raw };
}

function check_buildin_and_modify(symbols_dict, symbol) {
    if (!buildin_symbols.map(raw => raw[0]).includes(symbol.name)) return false;
    const ref = symbols_dict[symbol.name];
    if (!ref) return false;
    // modify address
    ref.addr = symbol.addr;
    ref.block_no = symbol.block_no;
    ref.block_bit = symbol.block_bit;
    return true;
}

function add_symbol(symbols_dict, symbol_raw, default_type) {
    if (typeof default_type !== 'string') default_type = null;
    const symbol = parse(symbol_raw, default_type);
    // 非有效符号
    if (symbol === symbol_raw) throw_symbol_error(`符号必须是一个数组！ 原始值:"${symbol_raw}"`);

    // 内置符号则应用新地址
    const is_buildin = check_buildin_and_modify(symbols_dict, symbol);

    trace_info.push_symbol(symbol);
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

export function add_symbols(symbols_dict, symbol_raw_list) {
    return symbol_raw_list.map(symbol_raw => add_symbol(symbols_dict, symbol_raw));
}


function ref(item) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        return { value: item, type: 'ref' };
    }
    return item;
}

export function make_prop_symbolic(obj, prop, symbols_dict, default_type) {
    const value = obj[prop];
    if (Array.isArray(value)) {
        // 如是数组，则返回符号
        obj[prop] = add_symbol(symbols_dict, value, default_type);
    } else if (typeof value === 'string') {
        // 如是字符串，则返回求符号函数
        // 全部符号未加载完，需要惰性赋值，所以是函数
        // 函数最终返回符号或字串值引用对象
        lazyassign(obj, prop, () => symbols_dict[value] ?? ref(value));
    } else {
        // 数字或布尔值返回引用对象
        // 其它直接值返回本身
        obj[prop] = ref(value);
    }
}

const area_size = {
    M: 0.1,
    MB: 1.0,
    MW: 2.0,
    MD: 4.0,
    I: 0.1,
    IW: 2.0,
    PIW: 2.0,
    ID: 4.0,
    PID: 4.0,
    Q: 0.1,
    QW: 2.0,
    PQW: 2.0,
    QD: 4.0,
    PQD: 4.0,
}

// 第二遍扫描，检查并补全符号表
export function build_symbols(CPU) {
    const exist_bno = {};
    const { MA_list, IA_list, QA_list, symbols_dict } = CPU;
    const list = Object.values(symbols_dict);
    // 检查重复并建立索引
    list.forEach(symbol => {
        const name = symbol.name;
        try {
            if (['DB', 'FB', 'FC'].includes(symbol.block_name)) { // DB FB FC 自动分配块号
                if (symbol.block_no === '+') symbol.block_no = null;
                else symbol.block_no = parseInt(symbol.block_no); //取整
                symbol.block_bit = "";
                symbol.block_no = CPU[symbol.block_name + '_list'].push(symbol.block_no);
                symbol.addr = symbol.block_name + symbol.block_no;
            } else if (
                ['MD', 'MW', 'M', 'I', 'IW', 'PIW', 'ID', 'PID', 'Q', 'QW', 'PQW', 'QD', 'PQD'].includes(symbol.block_name)
            ) { // Area 自动分配地址
                if (symbol.block_no === '+') {
                    symbol.block_no = null;
                    symbol.block_bit = 0;
                } else {
                    symbol.block_no = parseInt(symbol.block_no);
                    symbol.block_bit = parseInt(symbol.block_bit);
                }
                let list;
                if (symbol.block_name.includes('M')) list = MA_list;
                if (symbol.block_name.includes('I')) list = IA_list;
                if (symbol.block_name.includes('Q')) list = QA_list;
                const addr = list.push([symbol.block_no, symbol.block_bit], area_size[symbol.block_name]);
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
                    list.find(sym => sym.block_no === symbol.block_no && sym.block_name === symbol.block_name)
                );
            }
            console.log(e.message);
        }
        symbols_dict[name] = symbol;
    });
    // 补全类型
    list.forEach(symbol => {
        if (symbol.block_name == "OB" || symbol.block_name == "FB" || symbol.block_name == "FC" || symbol.type == null) {
            symbol.type = symbol.name;
        }
        if (common_type.includes(symbol.type)) {
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
export function get_S7_symbol({ name, type, block_name, block_no, block_bit, type_name, type_no = '', comment }) {
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

import { str_padding_left, str_padding_right } from "./str_padding.js";
import { IncHLError } from "./increase_hash_table.js";

export const AI_NAME = 'AI_Proc';
export const AI_LOOP_NAME = 'AI_Loop';
export const MB340_NAME = 'MB_340_Poll';
export const MB341_NAME = 'MB_341_Poll';
export const MB_LOOP_NAME = 'MB_Loop';
export const MB_POLLS_NAME = 'MB_polls_DB';
export const MT_NAME = 'MB_TCP_Poll';
export const MT_LOOP_NAME = 'MT_Loop';
export const MT_POLLS_NAME = 'MT_polls_DB';
export const VALVE_NAME = `Valve_Proc`;
export const VALVE_LOOP_NAME = 'Valve_Loop';
export const AI_BUILDIN = [
    [AI_NAME, 'FB512', AI_NAME, 'AI main AI FB'],
    [AI_LOOP_NAME, "FC512", AI_LOOP_NAME, 'main AI cyclic call function'],
];
export const MB_BUILDIN = [
    [MB340_NAME, 'FB345', MB340_NAME, 'CP340 modbusRTU communicate main process'],
    [MB341_NAME, 'FB346', MB341_NAME, 'CP341 modbusRTU communicate main process'],
    [MB_LOOP_NAME, "FC345", MB_LOOP_NAME, 'main modbusRTU cyclic call function'],
    [MB_POLLS_NAME, "DB880", MB_POLLS_NAME, 'modbusRTU polls data'],
];
export const MT_BUILDIN = [
    [MT_NAME, 'FB344', MT_NAME, 'modbusTCP OUC main process'],
    [MT_LOOP_NAME, "FC344", MT_LOOP_NAME, 'main modbusTCP cyclic call function'],
    [MT_POLLS_NAME, "DB881", MT_POLLS_NAME, 'modbusTCP polls data'],
];
export const VALVE_BUILDIN = [
    [VALVE_NAME, 'FB513', VALVE_NAME, 'VALVE main AI FB'],
    [VALVE_LOOP_NAME, "FC513", VALVE_LOOP_NAME, 'main AI cyclic call function'],
];
export const buildin_symbols = [
    ...AI_BUILDIN,
    ...MB_BUILDIN,
    ...MT_BUILDIN,
    ...VALVE_BUILDIN,
];
const common_type = ['BOOL', 'BYTE', 'INT', 'WORD', 'DWORD', 'DINT', 'REAL'];

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
    const reg = /^(MW|MD|M|FB|FC|DB|PIW|IW|I|PQW|QW|Q)(\d+|\+)(\.(\d))?$/;
    let [, block_name, block_no, , block_bit = 0] = reg.exec(addr.toUpperCase()) ?? [];
    if (!block_name || !block_no) return raw;
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
    if (!type && /^I|Q|M$/.test(block_name)) {
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

export function add_symbol(symbols_dict, symbol_raw, default_type) {
    // 引用，要么返回惰性求值，要么返回本身
    if (Object.prototype.toString.call(symbol_raw) === '[object Object]') {
        const ref_name = symbol_raw.buildin ?? symbol_raw.ref;
        const ref = ref_name && symbols_dict[ref_name];
        return ref // 返回符号
            ?? (() => { // 当前无此符号情况下则返回惰性求值函数
                return (ref_name && symbols_dict.find(symbol => symbol.name === ref_name)) ?? symbol_raw;
            });
    }
    const symbol = parse(symbol_raw, default_type);
    // 非有效符号返回原值 
    if (symbol === symbol_raw) return symbol_raw;

    // 内置符号则应用新地址
    const is_buildin = check_buildin_and_modify(symbols_dict, symbol);

    // 新符号则保存
    if (!is_buildin && symbols_dict[symbol.name]) throw new Error(`存在重复的符号名称 ${symbol.name}!\n${symbols_dict[symbol.name].raw}\n${symbol.raw}`);
    if (!is_buildin) symbols_dict[symbol.name] = symbol;
    return symbol;
}

export function add_symbols(symbols_dict, symbol_raw_list) {
    return symbol_raw_list.map(symbol_raw => add_symbol(symbols_dict, symbol_raw));
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
// 检查并补全符号表
export function rebuild_symbols(CPU) {
    const exist_bno = {};
    const { MA_list, IA_list, QA_list, symbols_dict } = CPU;
    const list = Object.values(symbols_dict);
    // 检查重复并建立索引
    list.forEach(symbol => {
        const name = symbol.name;
        if (['DB', 'FB', 'FC'].includes(symbol.block_name)) { // DB FB FC 自动分配块号
            if (symbol.block_no === '+') symbol.block_no = null;
            else symbol.block_no = parseInt(symbol.block_no); //取整
            symbol.block_bit = "";
            try {
                symbol.block_no = CPU[symbol.block_name + '_list'].push(symbol.block_no);
            } catch (e) {
                if (e instanceof TypeError) {
                    throw new TypeError(e.message, { cause: e });
                } else if (e instanceof IncHLError) {
                    const prev_symbol = list.find(sym => sym.block_no === symbol.block_no);
                    throw new Error(`${e.message}\n${prev_symbol.raw}\n${symbol.raw}`, { cause: e });
                }
            }
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
            throw new Error(`存在重复的地址 ${name} ${symbol.addr}!`)
        } else { // 不重复则标识该地址已存在
            exist_bno[symbol.addr] = true;
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
    return { CPU, list };
}

const SYMN_LEN = 23;
const NAME_LEN = 4;
const NO_LEN = 5;
const BLANK_COMMENT_LEN = 80;
function get_symbol({ name, type, block_name, block_no, block_bit, type_name, type_no = '', comment }) {
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
export function gen_symbol(symbols_confs) {
    const rules = [];
    symbols_confs.forEach(({ CPU, list }) => {
        const output_dir = CPU.output_dir;
        const symbol_list = list.map(get_symbol);
        rules.push({
            "name": `${output_dir}/symbols.asc`,
            "tags": { symbol_list }
        })
    });
    return { rules, template }
}

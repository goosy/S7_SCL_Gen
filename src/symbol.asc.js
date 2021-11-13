import {
    MT_connections,
    MB_TCP_Poll,
    MT_Loop,
    Poll_DB,
    recv_DBs,
    additional_symbol
} from "./gen_data.js";

const SYMB_LEN = 27;
const BLOCK_LEN = 11;
const TYPE_LEN = 9;
const BLANK_COMMENT_LEN = 80;

function fix_length_string(str, length) {
    if (str.length > length) return str.substr(0, length);
    length -= str.length;
    while (length--) {
        str += ' ';
    };
    return str;
}

function get_symbol(name, block_name, block_no, type_name, type_no, comment) {
    const head = fix_length_string('126,' + name, SYMB_LEN);
    let block_no_str = block_no.toString();
    block_no_str = (block_name == 'I' || block_name == 'Q') ? block_no_str : block_no_str + '  ';
    const block_str = (block_name + '         ').substr(0, BLOCK_LEN - block_no_str.length) + block_no_str;
    const type_no_str = type_no ? type_no.toString() : '';
    const type_str = (type_name + '         ').substr(0, TYPE_LEN - type_no_str.length) + type_no_str;
    const cm = fix_length_string(comment ?? '', BLANK_COMMENT_LEN);
    return `${head} ${block_str} ${type_str} ${cm}`;
}

const symbol_list = [
    get_symbol(MB_TCP_Poll.name, 'FB', MB_TCP_Poll.FB_NO, 'FB', MB_TCP_Poll.FB_NO),
    get_symbol(MT_Loop.name, 'FC', MT_Loop.FC_NO, 'FC', MT_Loop.FC_NO),
    get_symbol(Poll_DB.name, 'DB', Poll_DB.DB_NO, 'DB', Poll_DB.DB_NO),
    ...MT_connections.map(
        conn => get_symbol(conn.name, 'DB', conn.DB_NO, 'FB', MB_TCP_Poll.FB_NO)
    ),
    ...recv_DBs.map(
        db => get_symbol(db.name, 'DB', db.DB_NO, db.type[0] ?? 'DB', db.type[1] ?? db.DB_NO)
    ),
    ...additional_symbol,
];

export const rules = [{
    "name": `symbol.asc`,
    "tags": {
        symbol_list,
    },
}];

export const template = `{{#for sym in symbol_list}}
{{sym}}{{#endfor sym}}`;

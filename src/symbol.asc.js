import { configurations } from "./gen_data.js";
import { str_padding_left, str_padding_right } from "./str_padding.js";

const SYMN_LEN = 23;
const BNAME_LEN = 4;
const BNO_LEN = 7;
const TNAME_LEN = 4;
const TNO_LEN = 5;
const BLANK_COMMENT_LEN = 80;

function get_symbol(name, block_name, block_no, type_name, type_no, comment) {
    const symname = str_padding_right(name, SYMN_LEN);
    const block_name_str = str_padding_right(block_name, BNAME_LEN);
    block_no = (block_name == 'I' || block_name == 'Q') ? block_no : block_no + '  ';
    const block_no_str = str_padding_left(block_no, BNO_LEN);
    const type_str = str_padding_right(type_name, TNAME_LEN);
    type_no ??= '';
    const type_no_str = str_padding_left(type_no, TNO_LEN);
    const cm = str_padding_right(comment ?? '', BLANK_COMMENT_LEN);
    return `126,${symname} ${block_name_str}${block_no_str} ${type_str}${type_no_str} ${cm}`;
}

export const rules = [];
configurations.forEach(({ name, connections, MB_TCP_Poll, MT_Loop, polls_DB, recv_DBs, additional_symbol, output_dir }) => {
    const symbol_list = [
        get_symbol(MB_TCP_Poll.name, 'FB', MB_TCP_Poll.FB_NO, 'FB', MB_TCP_Poll.FB_NO),
        get_symbol(MT_Loop.name, 'FC', MT_Loop.FC_NO, 'FC', MT_Loop.FC_NO),
        get_symbol(polls_DB.name, 'DB', polls_DB.DB_NO, 'DB', polls_DB.DB_NO),
        ...connections.map(
            conn => get_symbol(conn.name, 'DB', conn.DB_NO, 'FB', MB_TCP_Poll.FB_NO)
        ),
        ...recv_DBs.map(
            db => get_symbol(db.name, 'DB', db.DB_NO, db.type[0] ?? 'DB', db.type[1] ?? db.DB_NO)
        ),
        ...additional_symbol,
    ];

    name = name ? name + '_' : '';
    rules.push({
        "name": `${name}symbol.asc`,
        "tags": { symbol_list }
    })
});

export const template = `{{#for sym in symbol_list}}{{sym}}
{{#endfor sym}}`;

import { configurations } from "./gen_data.js";
import { str_padding_left, str_padding_right } from "./str_padding.js";

const SYMN_LEN = 23;
const BNAME_LEN = 4;
const BNO_LEN = 7;
const TNAME_LEN = 4;
const TNO_LEN = 5;
const BLANK_COMMENT_LEN = 80;

function get_symbol({ name, block_name, block_no, type_name, type_no, comment }) {
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
configurations.forEach(({ connections, recv_DBs, options }) => {
    const { output_prefix, MB_TCP_Poll, MT_Loop, polls_DB, symbols } = options;
    const symbol_list = [
        get_symbol(MB_TCP_Poll),
        get_symbol(MT_Loop),
        get_symbol(polls_DB),
        ...connections.map(
            conn => get_symbol({ name: conn.name, block_name: 'DB', block_no: conn.DB_NO, type_name: 'FB', type_no: MB_TCP_Poll.type_no })
        ),
        ...recv_DBs.map(
            db => get_symbol({ name: db.name, block_name: 'DB', block_no: db.DB_NO, type_name: db.type.name ?? 'DB',  type_no: db.type.no ?? db.DB_NO })
        ),
        ...symbols.map(get_symbol),
    ];

    rules.push({
        "name": `${output_prefix}symbol.asc`,
        "tags": { symbol_list }
    })
});

export const template = `{{#for sym in symbol_list}}{{sym}}
{{#endfor sym}}`;

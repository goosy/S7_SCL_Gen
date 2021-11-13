import {
    MT_connections,
    MB_TCP_Poll,
    MT_Loop,
    Poll_DB,
    recv_DBs,
    fix_length_string,
    fix_block_name,
    additional_symbol
} from "./gen_data.js";

const BLANK_COMMENT = '                                                                                ';
const SYMB_LEN = 27;

function get_conn_DB_symbol(conn) {
    return fix_length_string('126,' + conn.name, SYMB_LEN) + ' ' + fix_block_name('DB', conn.DB_NO) + '   ' + MB_TCP_Poll.block_str + ' ' + BLANK_COMMENT;
}

const symbol_list = [
    fix_length_string('126,' + MB_TCP_Poll.name, SYMB_LEN) + ' ' + MB_TCP_Poll.block_str + '   ' + MB_TCP_Poll.block_str + ' ' + BLANK_COMMENT,
    fix_length_string('126,' + MT_Loop.name, SYMB_LEN) + ' ' + MT_Loop.block_str + '   ' + MT_Loop.block_str + ' ' + BLANK_COMMENT,
    fix_length_string('126,' + Poll_DB.name, SYMB_LEN) + ' ' + Poll_DB.block_str + '   ' + Poll_DB.block_str + ' ' + BLANK_COMMENT,
    ...MT_connections.map(get_conn_DB_symbol),
    ...recv_DBs.map(db => fix_length_string('126,' + db.name, SYMB_LEN) + ' ' + db.str + '   ' + (db.type ?? db.str) + ' ' + BLANK_COMMENT),
    ...additional_symbol,
];

export let rules = [{
    "name": `symbol.asc`,
    "tags": {
        symbol_list,
    },
}];

export let template = `{{#for sym in symbol_list}}
{{sym}}{{#endfor sym}}`;

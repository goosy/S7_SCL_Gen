import { CPUs } from "./gen_data.js";
import { str_padding_left, str_padding_right } from "./str_padding.js";

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

export const rules = [];

Object.values(CPUs).forEach(CPU => {
    const symbol_list = CPU.symbols.map(get_symbol);
    const output_dir = CPU.output_dir;
    rules.push({
        "name": `${output_dir}/symbols.asc`,
        "tags": { symbol_list }
    })
});

export const template = `{{#for sym in symbol_list}}{{sym}}
{{#endfor sym}}`;

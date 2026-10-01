import { make_s7_expression } from "../symbols.js";
import { context } from '../util.js';
import { STRING, ensure_value } from '../s7data.js';
import { posix } from 'node:path';
import { make_fake_DB, make_limit } from './analog_common.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = 'Limit_Proc';
export const LOOP_NAME = 'Limit_Loop';
const feature = 'limit';

export function is_feature(name) {
    const f_name = name.toLowerCase();
    return f_name === feature || f_name === 'limitcheck' || f_name === 'lc';
}

/**
 * First scan to extract symbols
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const location = ensure_value(STRING, node.get('location') ?? '').value;
        const type = ensure_value(STRING, node.get('type') ?? '').value;
        const comment = ensure_value(STRING, node.get('comment') ?? location + type).value;
        const LC = {
            node,
            location,
            type,
            comment,
            /**
             * @type { {
             *   tagname: string,
             *   location: string,
             *   event: string,
             *   PV1: string
             * }[] }
             */
        };
        const DB = node.get('DB');
        const input = node.get('input');
        if (!DB && !input) return LC; // Empty item is not processed

        LC.DB = make_fake_DB(DB);
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(ret => {
            LC.DB = ret;
        });
        make_s7_expression(
            input,
            {
                document,
                force: { type: 'REAL' },
                default: { comment },
                s7_expr_desc: `AI ${comment} input`,
            },
        ).then(ret => {
            LC.input = ret;
        });
        const invalid = node.get('invalid');
        make_s7_expression(
            invalid,
            {
                document,
                force: { type: 'BOOL' },
                default: { comment },
                s7_expr_desc: `AI ${comment} invalid`,
            },
        ).then(ret => {
            LC.invalid = ret;
        });
        make_limit(LC, node, document);

        return LC;
    });
}

export function build_list({ list }) {
    for (const LC of list) { // Process configuration to form complete data
        const input_paras = [
            ['input', 'PV'],
            ['invalid'],
            ['enable_HH'],
            ['enable_H'],
            ['enable_L'],
            ['enable_LL'],
        ].flatMap(_para => {
            const para_name = _para[0];
            const para_SCL = _para[1] ?? para_name;
            const para = LC[para_name];
            return para ? `${para_SCL} := ${para.value}` : [];
        });
        LC.input_paras = input_paras.join(', ');
    }
}

export function gen({ document, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME };
    const template = 'limit.template'; 
    return [{ distance, tags, output_dir, template }];
}

export function gen_copy_list({ document }) {
    const source = posix.join(NAME, `${NAME}(${document.CPU.platform}).scl`);
    const input_dir = context.module_path;
    const distance = posix.join(document.CPU.output_dir, `${NAME}.scl`);
    const output_dir = context.work_path;
    const IE = 'utf8';
    return [{ source, input_dir, distance, output_dir, IE }];
}

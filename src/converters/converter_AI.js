import { posix } from 'node:path';
import { make_s7_expression } from "../symbols.js";
import { INT, STRING, ensure_value, nullable_value } from '../s7data.js';
import { context } from '../util.js';
import { make_alarms, make_fake_DB } from './alarm_common.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = 'AI_Proc';
export const LOOP_NAME = 'AI_Loop';
const feature = 'AI';

export function is_feature(name) {
    return name.toUpperCase() === feature;
}

/**
 * First scan to extract symbols
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const location = ensure_value(STRING, node.get('location') ?? '').value;
        const type = ensure_value(STRING, node.get('type') ?? '').value;
        const comment = ensure_value(STRING, node.get('comment') ?? location + type).value;
        const AI = {
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
        if (!DB && !input) return AI; // Empty AI is not processed

        AI.DB = make_fake_DB(DB);
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(ret => { AI.DB = ret; });
        make_s7_expression(
            input,
            {
                document,
                force: { type: 'WORD' },
                default: { comment },
                s7_expr_desc: `${comment} input`,
            },
        ).then(ret => { AI.input = ret; });

        AI.$zero_raw = nullable_value(INT, node.get('$zero_raw'));
        AI.$span_raw = nullable_value(INT, node.get('$span_raw'));
        AI.$overflow_SP = nullable_value(INT, node.get('$overflow_SP'));
        AI.$underflow_SP = nullable_value(INT, node.get('$underflow_SP'));
        make_alarms(AI, node, document);

        return AI;
    });
}

export function build_list({ list }) {
    for (const AI of list) { // Process configuration to form complete data
        const input_paras = [
            ['input', 'AI'],
            ['enable_AH'],
            ['enable_WH'],
            ['enable_WL'],
            ['enable_AL'],
        ].flatMap(input_para => {
            const para_name = input_para[0];
            const para_SCL = input_para[1] ?? para_name;
            const para = AI[para_name];
            return para ? `${para_SCL} := ${para.value}` : [];
        });
        AI.input_paras = input_paras.join(', ');
    }
}

export function gen({ document, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME };
    const template = 'AI.template'; 
    return [{ distance, output_dir, tags, template }];
}

export function gen_copy_list({ document }) {
    const source = posix.join(NAME, `${NAME}(${document.CPU.platform}).scl`);
    const input_dir = context.module_path;
    const distance = posix.join(document.CPU.output_dir, `${NAME}.scl`);
    const output_dir = context.work_path;
    const IE = 'utf8';
    return [{ source, input_dir, distance, output_dir, IE }];
}

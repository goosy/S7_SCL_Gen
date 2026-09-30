import { posix } from 'node:path';
import { make_s7_expression } from "../symbols.js";
import { INT, STRING, ensure_value } from '../s7data.js';
import { context, elog } from '../util.js';
import {
    DEFAULT_OVERFLOW_SP, DEFAULT_SPAN_RAW, DEFAULT_UNDERFLOW_SP, DEFAULT_ZERO_RAW, S7_AI_MAX, S7_AI_MIN,
    make_alarms, make_fake_DB, raw_SP,
} from './analog_common.js';

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

        // Raw keys are always written to the instance DB, defaults included
        AI.$zero_raw = new INT(node.get('$zero_raw') ?? DEFAULT_ZERO_RAW);
        AI.$span_raw = new INT(node.get('$span_raw') ?? DEFAULT_SPAN_RAW);
        // Percentages are relative to the raw range
        const zero_raw = AI.$zero_raw.value;
        const span_raw = AI.$span_raw.value;
        AI.$overflow_SP = raw_SP(node.get('$overflow_SP') ?? DEFAULT_OVERFLOW_SP, `AI (${comment}) 的 $overflow_SP`, zero_raw, span_raw);
        AI.$underflow_SP = raw_SP(node.get('$underflow_SP') ?? DEFAULT_UNDERFLOW_SP, `AI (${comment}) 的 $underflow_SP`, zero_raw, span_raw);
        make_alarms(AI, node, document);

        return AI;
    });
}

/**
 * Validate the raw range and the overflow / underflow setpoints
 * @param {object} AI
 * @param {string} CPU_name
 * @returns {void}
 */
function check_raw(AI, CPU_name) {
    const zero_raw = AI.$zero_raw.value;
    const span_raw = AI.$span_raw.value;
    if (zero_raw === span_raw) {
        elog(new SyntaxError(`${CPU_name}:AI (${AI.comment}) 的 zero_raw 与 span_raw 不能相等 (${zero_raw})`));
    }
    for (const key of ['$overflow_SP', '$underflow_SP']) {
        const raw = AI[key].value;
        if (raw <= S7_AI_MIN || raw >= S7_AI_MAX) {
            elog(new SyntaxError(`${CPU_name}:AI (${AI.comment}) 的 ${key} 原始值 ${raw} 超出范围 ${S7_AI_MIN + 1} ~ ${S7_AI_MAX - 1}`));
        }
    }
    const high = AI.$overflow_SP.value;
    const low = AI.$underflow_SP.value;
    if (high <= low) {
        elog(new SyntaxError(`${CPU_name}:AI (${AI.comment}) 的上溢出值 (overflow_SP ${high}) 必须大于下溢出值 (underflow_SP ${low})`));
    }
}

export function build_list({ document, list }) {
    for (const AI of list) { // Process configuration to form complete data
        if (AI.DB) check_raw(AI, document.CPU.name);
        const input_paras = [
            ['input', 'AI'],
            ['enable_HH'],
            ['enable_H'],
            ['enable_L'],
            ['enable_LL'],
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

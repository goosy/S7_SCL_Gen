import { posix } from 'node:path';
import { make_s7_expression } from "../symbols.js";
import { INT, STRING, ensure_value, nullable_value } from '../s7data.js';
import { context } from '../util.js';
import { make_alarm_props, make_fake_DB } from './alarm_common.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = 'AI_Proc';
export const LOOP_NAME = 'AI_Loop';
const feature = 'AI';

export function is_feature(name) {
    return name.toUpperCase() === feature;
}

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    const alarms_list = document.CPU.alarms_list;
    area.list = area.list.map(node => {
        const location = ensure_value(STRING, node.get('location') ?? '').value;
        const type = ensure_value(STRING, node.get('type') ?? '').value;
        const comment = ensure_value(STRING, node.get('comment') ?? location + type).value;
        const AI = {
            node,
            location,
            type,
            comment,
        };
        const DB = node.get('DB');
        const input = node.get('input');
        if (!DB && !input) return AI; // 空AI不处理

        AI.DB = make_fake_DB(DB);
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(ret => AI.DB = ret);
        make_s7_expression(
            input,
            {
                document,
                force: { type: 'WORD' },
                default: { comment },
                s7_expr_desc: `${comment} input`,
            },
        ).then(ret => AI.input = ret);

        AI.$zero_raw = nullable_value(INT, node.get('$zero_raw'));
        AI.$span_raw = nullable_value(INT, node.get('$span_raw'));
        AI.$overflow_SP = nullable_value(INT, node.get('$overflow_SP'));
        AI.$underflow_SP = nullable_value(INT, node.get('$underflow_SP'));

        const alarms = make_alarm_props(AI, node, document);
        alarms_list.push(...alarms);
        return AI;
    });
}

export function build_list({ list }) {
    list.forEach(AI => { // 处理配置，形成完整数据
        function make_paras(para_list) {
            const input_paras = [];
            para_list.forEach(_para => {
                const para_name = _para[0];
                const para_SCL = _para[1] ?? para_name;
                const para = AI[para_name];
                if (para) {
                    input_paras.push(`${para_SCL} := ${para.value}`);
                }
            });
            return input_paras;
        }
        AI.input_paras = make_paras([
            ['input', 'AI'],
            ['enable_AH'],
            ['enable_WH'],
            ['enable_WL'],
            ['enable_AL'],
        ]).join(', ');
    });
}

export function gen({ document, options = {} }) {
    const { CPU } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME + '.scl' } = options;
    const path = `${output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME };
    const template = 'AI.template';
    return [{ path, tags, template }];
}

export function gen_copy_list(item) {
    const src = posix.join(context.module_path, NAME, `${NAME}(${item.document.CPU.platform}).scl`);
    const IE = 'utf8';
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst, IE }];
}

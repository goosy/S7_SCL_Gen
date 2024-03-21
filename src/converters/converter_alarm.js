import { make_s7_expression } from "../symbols.js";
import { context } from '../util.js';
import { STRING, ensure_value } from '../s7data.js';
import { posix } from 'node:path';
import { make_alarm_props, make_fake_DB } from './alarm_common.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = 'Alarm_Proc';
export const LOOP_NAME = 'Alarm_Loop';
const feature = 'alarm';

export function is_feature(name) {
    name = name.toLowerCase();
    return name === feature || name === 'pv_alarm' || name === 'pv' || name === 'pvalarm';
}

/**
 * 第一遍扫描 提取符号
 * @date 2022-1-17
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
        const alarm = {
            node,
            location,
            type,
            comment,
        };
        const DB = node.get('DB');
        const input = node.get('input');
        if (!DB && !input) return alarm; // 空alarm不处理

        alarm.DB = make_fake_DB(DB);
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(ret => alarm.DB = ret);
        make_s7_expression(
            input,
            {
                document,
                force: { type: 'REAL' },
                default: { comment },
                s7_expr_desc: `AI ${comment} input`,
            },
        ).then(ret => alarm.input = ret);
        const invalid = node.get('invalid');
        make_s7_expression(
            invalid,
            {
                document,
                force: { type: 'BOOL' },
                default: { comment },
                s7_expr_desc: `AI ${comment} invalid`,
            },
        ).then(ret => alarm.invalid = ret);

        const alarms = make_alarm_props(alarm, node, document);
        alarms_list.push(...alarms);

        return alarm;
    });
}

export function build_list({ list }) {
    list.forEach(alarm => { // 处理配置，形成完整数据
        function make_paras(para_list) {
            const input_paras = [];
            para_list.forEach(_para => {
                const para_name = _para[0];
                const para_SCL = _para[1] ?? para_name;
                const para = alarm[para_name];
                if (para) {
                    input_paras.push(`${para_SCL} := ${para.value}`);
                }
            });
            return input_paras;
        }
        alarm.input_paras = make_paras([
            ['input', 'PV'],
            ['invalid'],
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
    const template = 'alarm.template';
    return [{ path, tags, template }];
}

export function gen_copy_list(item) {
    const src = posix.join(context.module_path, NAME, `${NAME}(${item.document.CPU.platform}).scl`);
    const IE = 'utf8';
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst, IE }];
}

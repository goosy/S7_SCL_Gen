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
    const f_name = name.toLowerCase();
    return f_name === feature || f_name === 'pv_alarm' || f_name === 'pv' || f_name === 'pvalarm';
}

/**
 * First scan to extract symbols
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
        if (!DB && !input) return alarm; // Empty alarm is not processed

        alarm.DB = make_fake_DB(DB);
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(ret => {
            alarm.DB = ret;
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
            alarm.input = ret;
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
            alarm.invalid = ret;
        });

        const alarms = make_alarm_props(alarm, node, document);
        alarms_list.push(...alarms);

        return alarm;
    });
}

export function build_list({ list }) {
    for (const alarm of list) { // Process configuration to form complete data
        const input_paras = [
            ['input', 'PV'],
            ['invalid'],
            ['enable_AH'],
            ['enable_WH'],
            ['enable_WL'],
            ['enable_AL'],
        ].flatMap(_para => {
            const para_name = _para[0];
            const para_SCL = _para[1] ?? para_name;
            const para = alarm[para_name];
            return para ? `${para_SCL} := ${para.value}` : [];
        });
        alarm.input_paras = input_paras.join(', ');
    }
}

export function gen({ document, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME };
    const template = posix.join(context.module_path, 'src/converters/alarm.template');
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

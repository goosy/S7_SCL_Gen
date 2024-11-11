import { make_s7_expression } from '../symbols.js';
import { BOOL, STRING, nullable_value, TIME } from '../s7data.js';
import { context, pad_right } from '../util.js';
import { posix } from 'node:path';

export const platforms = ['step7', 'portal']; // platforms supported by this feature
export const NAME = 'Motor_Proc';
export const LOOP_NAME = 'Motor_Loop';
const feature = 'motor';

export function is_feature(name) {
    return name.toLowerCase() === feature;
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
        const motor = {
            node,
            comment: new STRING(node.get('comment') ?? '')
        };
        const comment = motor.comment.value;
        const DB = node.get('DB');
        if (!DB) return motor; // Empty blocks are not processed
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(symbol => {
            motor.DB = symbol;
        });

        function make_bool_s7s(prop) {
            const _comment = comment ? `${comment} ${prop}` : '';
            const value = node.get(prop);
            if (value !== undefined) make_s7_expression(
                value,
                {
                    document,
                    force: { type: 'BOOL' },
                    default: { comment: _comment },
                    s7_expr_desc: `motor ${comment} ${prop}`,
                },
            ).then(symbol => {
                motor[prop] = symbol;
            });
        }
        ['enable', 'run', 'error', 'remote'].forEach(make_bool_s7s);
        ['run_action', 'start_action', 'stop_action', 'estop_action'].forEach(make_bool_s7s);

        motor.$stateless = nullable_value(BOOL, node.get('$stateless'));
        motor.$over_time = nullable_value(TIME, node.get('$over_time'));

        return motor;
    });
}

export function build_list({ document, list }) {
    const platform = document.CPU.platform;
    for (const motor of list) { // Process configuration to form complete data
        const input_paras = [
            ['remote'],
            ['enable', 'enable_run'],
            ['run'],
            ['error']
        ].flatMap(([name, para]) => {
            const prop = motor[name];
            return prop ? [[para ?? name, prop.value]] : [];
        });
        const output_paras = [
            ['run_action', 'run_coil'],
            ['start_action', 'start_coil'],
            ['stop_action', 'stop_coil'],
            ['estop_action', 'E_stop_coil']
        ].flatMap(([name, para]) => {
            const prop = motor[name];
            return prop ? [[para ?? name, prop.value]] : [];
        });
        const inputs_len = input_paras.length;
        const outputs_len = output_paras.length;
        const len = platform === 'portal'
            ? inputs_len + outputs_len
            : inputs_len;
        motor.paras_len = len;
        motor.input_paras = input_paras.map(([name, value], index) => {
            let postfix = '';
            if (platform === 'portal') {
                if (len > 1) name = pad_right(name, 12);
                if (index + 1 < len) postfix = ',';
            } else {
                if (inputs_len > 1) name = pad_right(name, 12);
                if (index + 1 < inputs_len) postfix = ',';
            }
            return `${name} := ${value}${postfix}`;
        });
        motor.output_paras = output_paras.map(([name, value], index) => {
            let postfix = '';
            if (platform === 'portal') {
                if (len > 1) name = pad_right(name, 12);
                if (index + 1 < outputs_len) postfix = ',';
                return `${name} => ${value}${postfix}`;
            }
            return `${value} := ${motor.DB.value}.${name};`;
        });
        motor.paras = [...motor.input_paras, ...motor.output_paras]; // for portal
    }
}

export function gen({ document, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME };
    const template = posix.join(context.module_path, 'src/converters/motor.template');
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

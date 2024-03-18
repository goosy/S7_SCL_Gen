import { make_s7_expression } from '../symbols.js';
import { BOOL, STRING, nullable_value, TIME } from '../s7data.js';
import { context, pad_right } from '../util.js';
import { posix } from 'node:path';

export const platforms = ['step7', 'portal']; // platforms supported by this feature
export const NAME = `Motor_Proc`;
export const LOOP_NAME = 'Motor_Loop';
const feature = 'motor';

export function is_feature(name) {
    return name.toLowerCase() === feature;
}

/**
 * 第一遍扫描 提取符号
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
        if (!DB) return motor; // 空块不处理
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(
            symbol => motor.DB = symbol
        );

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
            ).then(
                symbol => motor[prop] = symbol
            );
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
    function make_paras(motor, para_pair_list) {
        const ret = [];
        para_pair_list.forEach(([name, para]) => {
            const prop = motor[name];
            if (prop) {
                para ??= name;
                ret.push([para, prop.value]);
            }
        });
        return ret;
    }
    list.forEach(motor => { // 处理配置，形成完整数据
        const input_paras = make_paras(motor, [
            ['remote'],
            ['enable', 'enable_run'],
            ['run'],
            ['error']
        ]);
        const output_paras = make_paras(motor, [
            ['run_action', 'run_coil'],
            ['start_action', 'start_coil'],
            ['stop_action', 'stop_coil'],
            ['estop_action', 'E_stop_coil']
        ]);
        const inputs_len = input_paras.length;
        const outputs_len = output_paras.length;
        const len = platform == 'portal'
            ? inputs_len + outputs_len
            : inputs_len;
        motor.paras_len = len;
        motor.input_paras = input_paras.map(([name, value], index) => {
            let postfix = '';
            if (platform == 'portal') {
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
            if (platform == 'portal') {
                if (len > 1) name = pad_right(name, 12);
                if (index + 1 < outputs_len) postfix = ',';
                return `${name} => ${value}${postfix}`;
            } else {
                return `${value} := ${motor.DB.value}.${name};`;
            }
        });
        motor.paras = [...motor.input_paras, ...motor.output_paras]; // for portal
    });
}

export function gen({ document, options = {} }) {
    const { CPU } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME + '.scl' } = options;
    const path = `${output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME };
    const template = 'motor.template';
    return [{ path, tags, template }];
}

export function gen_copy_list(item) {
    const src = {
        filename: posix.join(context.module_path, NAME, `${NAME}(${item.document.CPU.platform}).scl`),
        encoding: 'utf8',
    };
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst }];
}

import { make_s7express } from '../symbols.js';
import { BOOL, STRING, nullable_typed_value, nullable_PINT } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7', 'portal'];
export const NAME = `Motor_Proc`;
export const LOOP_NAME = 'Motor_Loop';

export function is_feature(feature) {
    return feature.toLowerCase() === 'motor';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}
{{#for motor in list}}{{#if motor.DB}}
// motor背景块: {{motor.comment}}
DATA_BLOCK {{motor.DB.value}}{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'FALSE' }{{#endif portal}}
AUTHOR : Goosy
FAMILY : GooLib
"{{NAME}}"
BEGIN{{#if motor.$stateless != null}}
    stateless := {{motor.$stateless}};{{#endif}}{{#if motor.$over_time != null}}
    over_time := {{motor.$over_time}};{{#endif}}
END_DATA_BLOCK
{{#endif}}{{#endfor motor}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1{{#endif platform}}
BEGIN{{#for motor in list}}
// {{motor.comment}}{{#if motor.DB}}
{{#if platform == 'step7'}}"{{NAME}}".{{#endif platform
}}{{motor.DB.value}}({{motor.input_paras}}{{

#if platform == 'step7'}});{{#if motor.run_action}}
{{motor.run_action.value}} := {{motor.DB.value}}.run_coil;{{#endif}}{{#if motor.start_action}}
{{motor.start_action.value}} := {{motor.DB.value}}.start_coil;{{#endif}}{{#if motor.stop_action}}
{{motor.stop_action.value}} := {{motor.DB.value}}.stop_coil;{{#endif}}{{#if motor.estop_action}}
{{motor.estop_action.value}} := {{motor.DB.value}}.E_stop_coil;{{#endif}}{{

#else platform == 'portal'}}{{#if motor.run_action}},
    run_coil    => {{motor.run_action.value}}{{#endif}}{{#if motor.start_action}},
    start_coil  => {{motor.start_action.value}}{{#endif}}{{#if motor.stop_action}},
    stop_coil   => {{motor.stop_action.value}}{{#endif}}{{#if motor.estop_action}},
    E_stop_coil => {{motor.estop_action.value}}{{#endif}});{{

#endif platform}}
{{#endif motor.DB}}{{#endfor motor}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

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
        make_s7express(motor, 'DB', DB, document, { force: { type: NAME }, default: { comment } });

        function make_bool_s7s(prop) {
            const _comment = comment ? `${comment} ${prop}` : '';
            const value = node.get(prop);
            if (value !== undefined) make_s7express(motor, prop, value, document, {
                s7express: true,
                force: { type: 'BOOL' },
                default: { comment: _comment }
            });
        }
        ['enable', 'run', 'error', 'remote'].forEach(make_bool_s7s);
        ['run_action', 'start_action', 'stop_action', 'estop_action'].forEach(make_bool_s7s);

        motor.$stateless = nullable_typed_value(BOOL, node.get('$stateless'));
        motor.$over_time = nullable_PINT(node.get('$over_time'));

        return motor;
    });
}

export function build_list({ list }) {
    list.forEach(motor => { // 处理配置，形成完整数据
        const {
            remote,
            enable,
            run,
            stateless,
            error,
            over_time,
        } = motor;
        const input_paras = [];

        if (remote) {
            input_paras.push(`remote      := ${remote.value}`);
        }
        if (enable) {
            input_paras.push(`enable_run  := ${enable.value}`);
        }
        if (run) {
            input_paras.push(`run         := ${run.value}`);
        }
        if (stateless) {
            input_paras.push(`stateless   := ${stateless}`); // stateless is not a symbol
        }
        if (error) {
            input_paras.push(`error       := ${error.value}`);
        }
        // 只有一项时让SCL字串紧凑
        if (input_paras.length == 1) input_paras[0] = input_paras[0].replace(/ +/g, ' ');
        if (input_paras.length > 1) input_paras[0] = '\n    ' + input_paras[0];
        motor.input_paras = input_paras.join(',\n    ');
    });
}

export function gen(motor_list) {
    const rules = [];
    motor_list.forEach(({ document, includes, loop_additional_code, list }) => {
        const { CPU, gcl } = document;
        const { output_dir, platform } = CPU;
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
                platform,
                includes,
                loop_additional_code,
                NAME,
                LOOP_NAME,
                list,
                gcl,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_copy_list(item) {
    const src = posix.join(context.module_path, `${NAME}/${NAME}(${item.document.CPU.platform}).scl`);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst }];
}

import { make_s7_expression } from '../symbols.js';
import { BOOL, STRING, nullable_value, TIME, pad_right } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7', 'portal']; // platforms supported by this feature
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
    over_time := {{motor.$over_time.DINT}};{{#endif}}
END_DATA_BLOCK
{{#endif}}{{#endfor motor}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1{{#endif platform}}
BEGIN{{#if loop_begin}}
{{loop_begin}}

{{#endif}}{{#for motor in list}}{{len = motor.input_paras.length + motor.output_paras.length}}
// {{motor.comment}}{{#if motor.DB}}
{{#if platform == 'step7'}}"{{NAME}}".{{#endif platform
}}{{motor.DB.value}}({{

#if platform == 'portal'}}{{
#for no,para in motor.input_paras}}{{#if len > 1}}{{#if no > 0}},{{#endif no}}
    {{#endif length}}{{para}}{{#endfor para}}{{
#for no,para in motor.output_paras}}{{#if len > 1}}{{#if no + motor.input_paras.length > 0}},{{#endif}}
    {{#endif len}}{{para}}{{#endfor para}});{{

#else other platform}}{{
#for no,para in motor.input_paras}}{{#if motor.input_paras.length > 1}}{{#if no > 0}},{{#endif no}}
    {{#endif len}}{{para}}{{#endfor para}});{{
#for para in motor.output_paras}}
{{para}};{{#endfor para}}{{

#endif platform}}
{{#endif motor.DB}}{{#endfor motor}}{{#if loop_end}}

{{loop_end}}{{#endif}}
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
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
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

export function build_list({ list }) {
    list.forEach(motor => { // 处理配置，形成完整数据
        function make_paras(para_list, prop) {
            para_list.forEach(_para => {
                const para = motor[_para];
                if (para) {
                    prop.push([_para, para.value]);
                }
            });
        }

        motor.input_paras = [];
        make_paras(['remote', 'enable', 'run', 'error'], motor.input_paras);
        motor.output_paras = [];
        make_paras(['run_action', 'start_action', 'stop_action', 'estop_action'], motor.output_paras);
    });
}

export function gen(motor_list) {
    const rules = [];
    motor_list.forEach(({ document, includes, loop_begin, loop_end, list }) => {
        const { CPU, gcl } = document;
        const { output_dir, platform } = CPU;
        list.forEach(motor => {
            const len = platform == 'portal'
                ? motor.input_paras.length + motor.output_paras.length
                : motor.input_paras.length;
            motor.input_paras = motor.input_paras.map(([name, value]) => {
                if (name === 'enable') name = 'enable_run';
                name = len > 1 ? pad_right(name, 12) : name;
                return `${name} := ${value}`;
            });
            motor.output_paras = motor.output_paras.map(([name, value]) => {
                name = name.replace(/_action$/, '_coil').replace('estop', 'E_stop');
                name = platform == 'portal' && len > 1 ? pad_right(name, 12) : name;
                if (platform == 'portal') {
                    return `${name} => ${value}`;
                } else {
                    return `${value} := ${motor.DB.value}.${name}`;
                }
            });
        })
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
                platform,
                includes,
                loop_begin,
                loop_end,
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

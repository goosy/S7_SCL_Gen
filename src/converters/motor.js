import { make_prop_symbolic } from '../symbols.js';
import { join } from 'path';

export const MOTOR_NAME = `Motor_Proc`;
export const MOTOR_LOOP_NAME = 'Motor_Loop';
export const MOTOR_BUILDIN = [
    [MOTOR_NAME, 'FB514', MOTOR_NAME, 'MOTOR main AI FB'],
    [MOTOR_LOOP_NAME, "FC514", MOTOR_LOOP_NAME, 'main motor cyclic call function'],
];
export function is_type_motor(type) {
    return type.toLowerCase() === 'motor';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}

// 主循环调用
FUNCTION "{{MOTOR_LOOP_NAME}}" : VOID
{{#for motor in list}}
// {{motor.comment}}{{#if motor.DB}}
"{{MOTOR_NAME}}".{{motor.DB.value}}({{motor.input_paras}});{{#if motor.run_action}}
{{motor.run_action.value}} := {{motor.DB.value}}.run_coil;{{#endif}}{{#if motor.start_action}}
{{motor.start_action.value}} := {{motor.DB.value}}.start_coil;{{#endif}}{{#if motor.stop_action}}
{{motor.stop_action.value}} := {{motor.DB.value}}.stop_coil;{{#endif}}{{#if motor.estop_action}}
{{motor.estop_action.value}} := {{motor.DB.value}}.E_stop_coil;{{#endif}}
{{#endif}}{{#endfor motor}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols_motor({ CPU, list }) {
    const document = CPU.motor;
    list.forEach(motor => {
        if (!motor.DB) return; // 空块不处理

        function symbolic(default_type, comment) {
            if (comment) return function (prop) {
                if (Array.isArray(motor[prop])) motor[prop][3] ??= `${comment} ${prop}`;
                make_prop_symbolic(motor, prop, CPU, { document, range: [0, 0, 0], default_type });
            }
            return function (prop) {
                make_prop_symbolic(motor, prop, CPU, { document, range: [0, 0, 0], default_type });
            }
        }

        symbolic(MOTOR_NAME, motor.comment)('DB');
        ['enable', 'run', 'error', 'remote'].forEach(symbolic('BOOL', motor.comment));
        ['timer_pulse'].forEach(symbolic('BOOL'));
        ['run_action', 'start_action', 'stop_action', 'estop_action'].forEach(symbolic('BOOL', motor.comment));
    });
}

export function build_motor({ list }) {
    list.forEach(motor => { // 处理配置，形成完整数据
        const {
            remote,
            enable,
            run,
            stateless,
            error,
            timer_pulse,
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
        if (timer_pulse) {
            input_paras.push(`timer_pulse := ${timer_pulse.value}`);
        }
        if (over_time) {
            input_paras.push(`over_time   := ${over_time}`); // over_time is not a symbol
        }
        // 只有一项时让SCL字串紧凑
        input_paras[0] = input_paras.length == 1 ? input_paras[0].replace(/ +/g, ' ') : '\n             ' + input_paras[0];
        motor.input_paras = input_paras.join(',\n             ');
    });
}

export function gen_motor(motor_list) {
    const rules = [];
    motor_list.forEach(({ CPU, includes, loop_additional_code, list }) => {
        const { name, output_dir } = CPU;
        rules.push({
            "name": `${output_dir}/${MOTOR_LOOP_NAME}.scl`,
            "tags": {
                name,
                includes,
                loop_additional_code,
                MOTOR_NAME,
                MOTOR_LOOP_NAME,
                list,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_motor_copy_list(item) {
    const output_dir = item.CPU.output_dir;
    return [{
        src: `Motor_Proc/${MOTOR_NAME}.scl`,
        dst: `${output_dir}/`,
        desc: `${join(process.cwd(), output_dir, MOTOR_NAME)}.scl`
    }];
}

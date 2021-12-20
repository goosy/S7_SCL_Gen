import { make_prop_symbolic, MOTOR_NAME, MOTOR_LOOP_NAME } from './symbols.js';

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}

// 主循环调用
FUNCTION "{{MOTOR_LOOP_NAME}}" : VOID
{{#for motor in list}}
// {{motor.comment}}{{#if motor.DB}}
"{{MOTOR_NAME}}".{{motor.DB.value}}({{motor.input_paras}});{{#if motor.start_action}}
{{motor.start_action.value}} := {{motor.DB.value}}.Run_Coil;{{#endif}}{{#if motor.stop_action}}
{{motor.stop_action.value}} := {{motor.DB.value}}.Stop_Coil;{{#endif}}{{#if motor.estop_action}}
{{motor.estop_action.value}} := {{motor.DB.value}}.EStop_Coil;{{#endif}}
{{#endif}}{{#endfor motor}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;


/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} motor_area
 * @returns {void}
 */
export function parse_symbols_motor(motor_area) {
    const symbols_dict = motor_area.CPU.symbols_dict;
    motor_area.list.forEach(motor => {
        if (!motor.DB) return; // 空块不处理
        make_prop_symbolic(motor, 'enable', symbols_dict, 'BOOL');
        make_prop_symbolic(motor, 'run_state', symbols_dict, 'BOOL');
        make_prop_symbolic(motor, 'remote', symbols_dict, 'BOOL');
        make_prop_symbolic(motor, 'error', symbols_dict, 'BOOL');
        make_prop_symbolic(motor, 'start_action', symbols_dict, 'BOOL');
        make_prop_symbolic(motor, 'stop_action', symbols_dict, 'BOOL');
        make_prop_symbolic(motor, 'estop_action', symbols_dict, 'BOOL');
        make_prop_symbolic(motor, 'time_pulse', symbols_dict, 'BOOL');
        make_prop_symbolic(motor, 'anti_interference_delay', symbols_dict, 'BOOL');
        make_prop_symbolic(motor, 'DB', symbols_dict, MOTOR_NAME);
    });
}

export function build_motor({ list }) {
    list.forEach(motor => { // 处理配置，形成完整数据
        const {
            enable,
            remote,
            error,
            run_state,
            anti_interference_delay,
            time_pulse,
        } = motor;
        const input_paras = [];

        if (enable) {
            input_paras.push(`  EN_Run     := ${enable.value}`);
        }
        if (run_state) {
            input_paras.push(`  Run_State  := ${run_state.value}`);
        }
        if (remote) {
            input_paras.push(`  Remote     := ${remote.value}`);
        }
        if (error) {
            input_paras.push(`  Error      := ${error.value}`);
        }
        if (anti_interference_delay) {
            input_paras.push(`  AID_Time   := ${anti_interference_delay.value}`);
        }
        if (time_pulse) {
            input_paras.push(`  Time_Pulse := ${time_pulse.value}`);
        }

        motor.input_paras = input_paras.length ? '\n' + input_paras.join(',\n') : '';
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
    return { rules, template };
}

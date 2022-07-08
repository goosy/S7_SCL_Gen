import { make_prop_symbolic } from '../symbols.js';
import { join } from 'path';

export const VALVE_NAME = `Valve_Proc`;
export const VALVE_LOOP_NAME = 'Valve_Loop';
export const VALVE_BUILDIN = `
- [${VALVE_NAME}, FB513, ${VALVE_NAME}, VALVE main AI FB]
- [${VALVE_LOOP_NAME}, FC513, ${VALVE_LOOP_NAME}, main valve cyclic call function]
`;
export function is_type_valve(type) {
    return type.toLowerCase() === 'valve';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}

// 主循环调用
FUNCTION "{{VALVE_LOOP_NAME}}" : VOID

CONST
    S7_ZERO := 0;
    S7_SPAN := 27648;
    S7_AI_MIN := -32768;
    S7_AI_MIN_WORD := W#16#8000;
    S7_AI_MAX := 32767;
    S7_AI_MAX_WORD := W#16#7FFF;
    STOP_STATUS := W#16#0;
    CLOSE_STATUS := W#16#1;
    OPEN_STATUS := W#16#2;
    MARCH_STATUS :=  W#16#4;
END_CONST
{{#for valve in list}}
// {{valve.comment}}{{#if valve.DB}}
"{{VALVE_NAME}}".{{valve.DB.value}}(
    AI := {{#if valve.AI}}{{valve.AI.value}}{{#else}}S7_AI_MIN_WORD{{#endif}},
    CP := {{valve.CP.value}},
    OP := {{valve.OP.value}}{{#if valve.error}},
    error := {{valve.error.value}}{{#endif}}{{#if valve.remote}},
    remote := {{valve.remote.value}}{{#endif}});{{#if valve.close_action}}
{{valve.close_action.value}} := "{{valve.DB.name}}".close_action;{{#endif}}{{#if valve.open_action}}
{{valve.open_action.value}} := "{{valve.DB.name}}".open_action;{{#endif}}{{#if valve.stop_action}}
{{valve.stop_action.value}} := "{{valve.DB.name}}".stop_action;{{#endif}}
{{#endif}}{{#endfor valve}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} valve_area
 * @returns {void}
 */
export function parse_symbols_valve({ CPU, list }) {
    const document = CPU.valve;
    list.forEach(valve => {
        if (!valve.DB) return; // 空AI不处理

        function symbolic(default_type, comment) {
            if (comment) return function (prop) {
                if (Array.isArray(valve[prop])) valve[prop][3] ??= `${comment} ${prop}`;
                make_prop_symbolic(valve, prop, CPU, { document, default_type });
            }
            return function (prop) {
                make_prop_symbolic(valve, prop, CPU, { document, default_type });
            }
        }

        symbolic(VALVE_NAME, valve.comment)('DB');
        symbolic('WORD', valve.comment)('AI');
        ['CP', 'OP', 'error', 'remote', 'close_action', 'open_action', 'stop_action'].forEach(symbolic('BOOL', valve.comment));
    });
}

export function gen_valve(valve_list) {
    const rules = [];

    valve_list.forEach(({ CPU, includes, loop_additional_code, list }) => {
        const { name, output_dir } = CPU;
        rules.push({
            "name": `${output_dir}/${VALVE_LOOP_NAME}.scl`,
            "tags": {
                name,
                includes,
                loop_additional_code,
                VALVE_NAME,
                VALVE_LOOP_NAME,
                list,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_valve_copy_list(item) {
    const output_dir = item.CPU.output_dir;
    return [{
        src: `Valve_Proc/${VALVE_NAME}.scl`,
        dst: `${output_dir}/`,
        desc: `${join(process.cwd(), output_dir, VALVE_NAME)}.scl`
    }];
}
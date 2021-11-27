import {VALVE_NAME, VALVE_LOOP_NAME} from './symbols.js';

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com

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
"{{VALVE_NAME}}".{{valve.DB.value}}({{#if valve.AI}}
    AI := {{valve.AI.value}},{{#endif}}
    CP := {{valve.CP.value}},
    OP := {{valve.OP.value}},
    error := {{valve.error.value}},
    remote := {{valve.remote.value}});{{#if valve.close_action}}
{{valve.close_action.value}} := "{{valve.DB.name}}".close_action;{{#endif}}{{#if valve.open_action}}
{{valve.open_action.value}} := "{{valve.DB.name}}".open_action;{{#endif}}
{{#endif}}{{#endfor valve}}
END_FUNCTION
`;

export function gen_valve(valve_confs) {
    const rules = [];

    valve_confs.forEach(({ CPU, list }) => {
        const { name, output_dir } = CPU;
        rules.push({
            "name": `${output_dir}/${VALVE_LOOP_NAME}.scl`,
            "tags": {
                name,
                VALVE_NAME,
                VALVE_LOOP_NAME,
                list,
            }
        })
    });
    return { rules, template };
}

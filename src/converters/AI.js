import { make_prop_symbolic } from "../symbols.js";
import { context } from '../util.js';
import { posix } from 'path';

export const NAME = 'AI_Proc';
export const LOOP_NAME = 'AI_Loop';
export const BUILDIN = `
- [${NAME}, FB512, ${NAME}, AI main AI FB]
- [${LOOP_NAME}, FC512, ${LOOP_NAME}, main AI cyclic call function]
`;

export function is_type(type) {
    return type.toUpperCase() === 'AI';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
{{#for AI in list}}{{#if AI.DB}}
// AI背景块: {{AI.comment}}
DATA_BLOCK "{{AI.DB.name}}" "{{NAME}}"
BEGIN{{#if AI.$enable_alarm != null}}
    enable_alarm := {{AI.$enable_alarm}};{{#endif}}{{#if AI.$zero_raw != null}}
    zero_raw := {{AI.$zero_raw}};{{#endif}}{{#if AI.$span_raw != null}}
    span_raw := {{AI.$span_raw}};{{#endif}}{{#if AI.$overflow_SP != null}}
    overflow_SP := {{AI.$overflow_SP}};{{#endif}}{{#if AI.$underflow_SP != null}}
    underflow_SP := {{AI.$underflow_SP}};{{#endif}}{{#if AI.$zero != null}}
    zero := {{AI.$zero}};{{#endif}}{{#if AI.$span != null}}
    span := {{AI.$span}};{{#endif}}{{#if AI.$AH_limit != null}}
    AH_limit := {{AI.$AH_limit}};{{#endif}}{{#if AI.$WH_limit != null}}
    WH_limit := {{AI.$WH_limit}};{{#endif}}{{#if AI.$WL_limit != null}}
    WL_limit := {{AI.$WL_limit}};{{#endif}}{{#if AI.$AL_limit != null}}
    AL_limit := {{AI.$AL_limit}};{{#endif}}{{#if AI.$dead_zone != null}}
    dead_zone := {{AI.$dead_zone}};{{#endif}}{{#if AI.$FT_time != null}}
    FT_time := L#{{AI.$FT_time}};{{#endif}}
END_DATA_BLOCK
{{#endif AI.DB}}{{#endfor AI}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#for AI in list}}
{{#if AI.DB}}"{{NAME}}"."{{AI.DB.name}}"(AI := {{AI.input.value}}{{#if AI.enable_alarm != undefined}}, enable_alarm := {{AI.enable_alarm}}{{#endif}}); {{#endif}}// {{AI.comment}}{{#endfor AI}}
{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols({ CPU, list }) {
    const document = CPU.AI;
    list.forEach(AI => {
        if (!AI.DB) return; // 空AI不处理
        if (Array.isArray(AI.DB)) AI.DB[3] ??= AI.comment;
        make_prop_symbolic(AI, 'DB', CPU, { document, force_type: NAME }); //强制类型
        if (Array.isArray(AI.input)) AI.input[3] ??= AI.comment;
        make_prop_symbolic(AI, 'input', CPU, { document, default_type: 'WORD' });
    });
}

export function gen(AI_list) {
    const rules = [];
    AI_list.forEach(({ CPU, includes, loop_additional_code, list, options = {} }) => {
        const { name, output_dir } = CPU;
        const { output_file = LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                NAME,
                LOOP_NAME,
                name,
                includes,
                loop_additional_code,
                list,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_copy_list(item) {
    const src = posix.join(context.module_path, `${NAME}/${NAME}(step7).scl`);
    const dst = posix.join(context.work_path, item.CPU.output_dir, NAME + '.scl');
    return [{ src, dst }];
}

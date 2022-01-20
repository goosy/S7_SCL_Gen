import { make_prop_symbolic } from "./symbols.js";
import { join } from 'path';

export const AI_NAME = 'AI_Proc';
export const AI_LOOP_NAME = 'AI_Loop';
export const AI_BUILDIN = [
    [AI_NAME, 'FB512', AI_NAME, 'AI main AI FB'],
    [AI_LOOP_NAME, "FC512", AI_LOOP_NAME, 'main AI cyclic call function'],
];

export function is_type_AI(type) {
    return type.toUpperCase() === 'AI';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
{{#for AI_item in list}}{{#if AI_item.DB}}
// AI背景块：{{AI_item.comment}}
DATA_BLOCK "{{AI_item.DB.name}}" "{{AI_NAME}}"
BEGIN{{#if AI_item.enable_alarm != undefined}}
    enable_alarm := {{AI_item.enable_alarm}};{{#endif}}{{#if AI_item.zero}}
    zero := {{AI_item.zero}};{{#endif}}{{#if AI_item.span}}
    span := {{AI_item.span}};{{#endif}}{{#if AI_item.AH_limit}}
    AH_limit := {{AI_item.AH_limit}};{{#endif}}{{#if AI_item.WH_limit}}
    WH_limit := {{AI_item.WH_limit}};{{#endif}}{{#if AI_item.WL_limit}}
    WL_limit := {{AI_item.WL_limit}};{{#endif}}{{#if AI_item.AL_limit}}
    AL_limit := {{AI_item.AL_limit}};{{#endif}}{{#if AI_item.dead_zone}}
    dead_zone := {{AI_item.dead_zone}};{{#endif}}{{#if AI_item.FT_time}}
    FT_time := L#{{AI_item.FT_time}};{{#endif}}
END_DATA_BLOCK
{{#endif}}{{#endfor AI_item}}

// 主循环调用
FUNCTION "AI_Loop" : VOID{{#for AI_item in list}}
{{#if AI_item.DB}}"{{AI_NAME}}"."{{AI_item.DB.name}}"(AI := {{AI_item.input.value}});  {{#endif}}// {{AI_item.comment}}{{#endfor AI_item}}
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
export function parse_symbols_AI(AI_area) {
    const symbols_dict = AI_area.CPU.symbols_dict;
    AI_area.list.forEach(AI => {
        if (!AI.DB) return; // 空AI不处理
        make_prop_symbolic(AI, 'DB', symbols_dict, AI_NAME);
        make_prop_symbolic(AI, 'input', symbols_dict, 'WORD');
    });
}

export function gen_AI(AI_list) {
    const rules = [];
    AI_list.forEach(({ CPU, includes, loop_additional_code, list, options={} }) => {
        const { name, output_dir } = CPU;
        const { output_file = AI_LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                AI_NAME,
                name,
                includes,
                loop_additional_code,
                list,
            }
        })
    });
    return { rules, template }
}

export function gen_AI_copy_list(item) {
    const output_dir = item.CPU.output_dir;
    return {
        src: `AI_Proc/${AI_NAME}(step7).scl`,
        dst: `${output_dir}/${AI_NAME}.scl`,
        desc: `${join(process.cwd(), output_dir, AI_NAME)}.scl`,
    };
}
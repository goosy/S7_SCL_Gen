import { AI_confs } from "./gen_data.js";

export const rules = [];
AI_confs.forEach(({ CPU, AI_list, options }) => {
    const { name, output_dir } = CPU;
    const { output_file = `AI_Loop` } = options;
    rules.push({
        "name": `${output_dir}/${output_file}.scl`,
        "tags": {
            name,
            AI_list,
        }
    })
});

export let template = `// 本代码由 S7_SCL_SRC_GEN ™ 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{#for AI_item in AI_list}}{{#if AI_item.zero}}
// AI背景块：{{AI_item.comment}}
DATA_BLOCK "{{AI_item.name}}" "AI_Proc"
BEGIN
    zero := {{AI_item.zero}};{{#if AI_item.span}}
    span := {{AI_item.span}};{{#endif}}{{#if AI_item.AH_limit}}
    AH_limit := {{AI_item.AH_limit}};{{#endif}}{{#if AI_item.WH_limit}}
    WH_limit := {{AI_item.WH_limit}};{{#endif}}{{#if AI_item.WL_limit}}
    WL_limit := {{AI_item.WL_limit}};{{#endif}}{{#if AI_item.AL_limit}}
    AL_limit := {{AI_item.AL_limit}};{{#endif}}
END_DATA_BLOCK
{{#endif}}{{#endfor AI_item}}

// 主循环调用
FUNCTION "AI_Loop" : VOID{{#for AI_item in AI_list}}
{{#if AI_item.AI}}AI_Proc."{{AI_item.name}}"(AI := "{{AI_item.AI}}");  {{#endif}}// {{AI_item.comment}}{{#endfor AI_item}}

END_FUNCTION
`;
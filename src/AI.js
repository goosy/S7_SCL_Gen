const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{#for AI_item in list}}{{#if AI_item.DB}}
// AI背景块：{{AI_item.comment}}
DATA_BLOCK "{{AI_item.DB.name}}" "AI_Proc"
BEGIN{{#if AI_item.enable_alarm != undefined}}
    enable_alarm := {{AI_item.enable_alarm}};{{#endif}}{{#if AI_item.zero}}
    zero := {{AI_item.zero}};{{#endif}}{{#if AI_item.span}}
    span := {{AI_item.span}};{{#endif}}{{#if AI_item.AH_limit}}
    AH_limit := {{AI_item.AH_limit}};{{#endif}}{{#if AI_item.WH_limit}}
    WH_limit := {{AI_item.WH_limit}};{{#endif}}{{#if AI_item.WL_limit}}
    WL_limit := {{AI_item.WL_limit}};{{#endif}}{{#if AI_item.AL_limit}}
    AL_limit := {{AI_item.AL_limit}};{{#endif}}{{#if AI_item.FT_time}}
    FT_time := L#{{AI_item.FT_time}};{{#endif}}
END_DATA_BLOCK
{{#endif}}{{#endfor AI_item}}

// 主循环调用
FUNCTION "AI_Loop" : VOID{{#for AI_item in list}}
{{#if AI_item.DB}}"AI_Proc"."{{AI_item.DB.name}}"(AI := {{AI_item.input.value}});  {{#endif}}// {{AI_item.comment}}{{#endfor AI_item}}

END_FUNCTION
`;

export function gen_AI(AI_confs) {
    const rules = [];
    AI_confs.forEach(({ CPU, list, options }) => {
        const { name, output_dir } = CPU;
        const { output_file = `AI_Loop` } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                name,
                list,
            }
        })
    });
    return { rules, template }
}

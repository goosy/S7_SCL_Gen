import { make_prop_symbolic } from "../symbols.js";
import { BOOL, INT, REAL, STRING, nullable_typed_value } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7', 'portal', 'pcs7'];
export const NAME = 'AI_Proc';
export const LOOP_NAME = 'AI_Loop';

export function is_feature(feature) {
    return feature.toUpperCase() === 'AI';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{document.gcl.file}}
// 摘要: {{document.gcl.MD5}}
{{includes}}
{{#for AI in list}}{{#if AI.DB && AI.input}}
// AI背景块: {{AI.comment}}
DATA_BLOCK "{{AI.DB.name}}"{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'FALSE' }{{#endif portal}}
AUTHOR : Goosy
FAMILY : GooLib
"{{NAME}}"
BEGIN{{#if AI.$enable_alarm !== undefined}}
    enable_alarm := {{AI.$enable_alarm}};{{#endif}}{{#if AI.$zero_raw !== undefined}}
    zero_raw := {{AI.$zero_raw}};{{#endif}}{{#if AI.$span_raw !== undefined}}
    span_raw := {{AI.$span_raw}};{{#endif}}{{#if AI.$overflow_SP !== undefined}}
    overflow_SP := {{AI.$overflow_SP}};{{#endif}}{{#if AI.$underflow_SP !== undefined}}
    underflow_SP := {{AI.$underflow_SP}};{{#endif}}{{#if AI.$zero !== undefined}}
    zero := {{AI.$zero}};{{#endif}}{{#if AI.$span !== undefined}}
    span := {{AI.$span}};{{#endif}}{{#if AI.$AH_limit !== undefined}}
    AH_limit := {{AI.$AH_limit}};{{#endif}}{{#if AI.$WH_limit !== undefined}}
    WH_limit := {{AI.$WH_limit}};{{#endif}}{{#if AI.$WL_limit !== undefined}}
    WL_limit := {{AI.$WL_limit}};{{#endif}}{{#if AI.$AL_limit !== undefined}}
    AL_limit := {{AI.$AL_limit}};{{#endif}}{{#if AI.$dead_zone !== undefined}}
    dead_zone := {{AI.$dead_zone}};{{#endif}}{{#if AI.$FT_time !== undefined}}
    FT_time := L#{{AI.$FT_time}};{{#endif}}
END_DATA_BLOCK
{{#endif AI.}}{{#endfor AI}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1{{#endif platform}}
BEGIN{{#for AI in list}}
{{#if AI.DB && AI.input
}}{{#if platform == 'step7'}}"{{NAME}}".{{#endif platform
}}"{{AI.DB.name}}"(AI := {{AI.input.value}}{{#if AI.enable_alarm != undefined}}, enable_alarm := {{AI.enable_alarm}}{{#endif}}); {{
#endif AI.}}// {{AI.comment}}{{#endfor AI}}
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
        if (!AI.DB && !AI.input) return; // 空AI不处理
        if (!AI.DB || !AI.input) throw new Error(`AI 功能中 DB 和 input 不能只定义1个!`);
        AI.comment = new STRING(AI.comment ?? '');
        const comment = AI.comment.value;
        make_prop_symbolic(AI, 'DB', CPU, { document, force: { type: NAME }, default: { comment } });
        make_prop_symbolic(AI, 'input', CPU, { document, force: { type: 'WORD' }, default: { comment } });
        AI.$enable_alarm = nullable_typed_value(BOOL, AI.$enable_alarm);
        AI.$zero_raw = nullable_typed_value(INT, AI.$zero_raw);
        AI.$span_raw = nullable_typed_value(INT, AI.$span_raw);
        AI.$overflow_SP = nullable_typed_value(INT, AI.$overflow_SP);
        AI.$underflow_SP = nullable_typed_value(INT, AI.$underflow_SP);
        AI.$zero = nullable_typed_value(REAL, AI.$zero);
        AI.$span = nullable_typed_value(REAL, AI.$span);
        AI.$AH_limit = nullable_typed_value(REAL, AI.$AH_limit);
        AI.$WH_limit = nullable_typed_value(REAL, AI.$WH_limit);
        AI.$WL_limit = nullable_typed_value(REAL, AI.$WL_limit);
        AI.$AL_limit = nullable_typed_value(REAL, AI.$AL_limit);
        AI.$dead_zone = nullable_typed_value(REAL, AI.$dead_zone);
        AI.$FT_time = nullable_typed_value(INT, AI.$FT_time);
    });
}

export function gen(AI_list) {
    const rules = [];
    AI_list.forEach(({ CPU, includes, loop_additional_code, list, options = {} }) => {
        const { output_dir, platform } = CPU;
        const { output_file = LOOP_NAME } = options;
        const document = CPU.AI;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                NAME,
                platform,
                LOOP_NAME,
                includes,
                loop_additional_code,
                list,
                document,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_copy_list(item) {
    const src = posix.join(context.module_path, `${NAME}/${NAME}(${item.CPU.platform}).scl`);
    const dst = posix.join(context.work_path, item.CPU.output_dir, NAME + '.scl');
    return [{ src, dst }];
}

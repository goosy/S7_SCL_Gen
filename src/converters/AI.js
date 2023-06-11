import { make_s7express } from "../symbols.js";
import { BOOL, INT, DINT, REAL, STRING, nullable_value } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7', 'portal', 'pcs7'];
export const NAME = 'AI_Proc';
export const LOOP_NAME = 'AI_Loop';

export function is_feature(feature) {
    return feature.toUpperCase() === 'AI';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
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
    FT_time := {{AI.$FT_time}};{{#endif}}
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
export function initialize_list(area) {
    const document = area.document;
    const gcl = document.gcl;
    area.list = area.list.map(node => {
        const AI = {
            node,
            comment: new STRING(node.get('comment') ?? '')
        };
        const DB = node.get('DB');
        const input = node.get('input');
        let info = gcl.get_pos_info(...node.range);
        if (!DB && !input) return AI; // 空AI不处理
        if (!DB || !input) throw new Error(`AI 功能中 DB 和 input 不能只定义1个:${info}`);
        const comment = AI.comment.value;
        make_s7express(AI, 'DB', DB, document, { force: { type: NAME }, default: { comment } });
        make_s7express(AI, 'input', input, document, {
            s7express: true,
            force: { type: 'WORD' },
            default: { comment }
        });
        const enable_alarm = node.get('enable_alarm');
        make_s7express(AI, 'enable_alarm', enable_alarm, document, {
            s7express: true,
            force: { type: 'BOOL' },
            default: { comment }
        });
        AI.$enable_alarm = nullable_value(BOOL, node.get('$enable_alarm'));
        AI.$zero_raw = nullable_value(INT, node.get('$zero_raw'));
        AI.$span_raw = nullable_value(INT, node.get('$span_raw'));
        AI.$overflow_SP = nullable_value(INT, node.get('$overflow_SP'));
        AI.$underflow_SP = nullable_value(INT, node.get('$underflow_SP'));
        AI.$zero = nullable_value(REAL, node.get('$zero')) ?? new REAL(0);
        AI.$span = nullable_value(REAL, node.get('$span')) ?? new REAL(100);
        AI.$AH_limit = nullable_value(REAL, node.get('$AH_limit')) ?? AI.$span;
        AI.$WH_limit = nullable_value(REAL, node.get('$WH_limit')) ?? AI.$span;
        AI.$WL_limit = nullable_value(REAL, node.get('$WL_limit')) ?? AI.$zero;
        AI.$AL_limit = nullable_value(REAL, node.get('$AL_limit')) ?? AI.$zero;
        if (
            AI.$WH_limit > AI.$AH_limit ||
            AI.$WL_limit > AI.$WH_limit ||
            AI.$AL_limit > AI.$WL_limit
        ) throw new Error(`the values of limitation were wrong 定义的限制值有错误\n${info}`);
        AI.$dead_zone = nullable_value(REAL, node.get('$dead_zone'));
        AI.$FT_time = nullable_value(DINT, node.get('$FT_time'));
        return AI;
    });
}

export function gen(AI_list) {
    const rules = [];
    AI_list.forEach(({ document, includes, loop_additional_code, list, options = {} }) => {
        const { CPU, gcl } = document;
        const { output_dir, platform } = CPU;
        const { output_file = LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                NAME,
                platform,
                LOOP_NAME,
                includes,
                loop_additional_code,
                list,
                gcl,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_copy_list(item) {
    const src = posix.join(context.module_path, `${NAME}/${NAME}(${item.document.CPU.platform}).scl`);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, NAME + '.scl');
    return [{ src, dst }];
}

import { make_s7_expression } from "../symbols.js";
import { INT, STRING, ensure_value, nullable_value } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';
import { make_alarm_props, make_fake_DB } from './alarm_common.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = 'AI_Proc';
export const LOOP_NAME = 'AI_Loop';

export function is_feature(feature) {
    return feature.toUpperCase() === 'AI';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}
{{#for AI in list}}{{#if AI.DB}}
// AI背景块: {{AI.comment}}
DATA_BLOCK {{AI.DB.value}}{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'FALSE' }{{#endif portal}}
AUTHOR : Goosy
FAMILY : GooLib
"{{NAME}}"
BEGIN
    enable_AH := {{AI.$enable_AH}};
    enable_WH := {{AI.$enable_WH}};
    enable_WL := {{AI.$enable_WL}};
    enable_AL := {{AI.$enable_AL}};{{#if AI.$zero_raw !== undefined}}
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
    FT_time := {{AI.$FT_time.DINT}};{{#endif}}
END_DATA_BLOCK
{{#endif AI.DB}}{{#endfor AI}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1{{#endif platform}}
BEGIN{{#if loop_begin}}
{{loop_begin}}

{{#endif}}{{#for AI in list}}
{{#if AI.DB && AI.input_paras
}}{{#if platform == 'step7' || platform == 'pcs7'}}"{{NAME}}".{{#endif platform
}}{{AI.DB.value}}({{AI.input_paras}}); {{#endif AI invoke
}}// {{AI.comment}}{{#endfor AI}}{{#if loop_end}}

{{loop_end}}{{#endif}}
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
    const alarms_list = document.CPU.alarms_list;
    area.list = area.list.map(node => {
        const location = ensure_value(STRING, node.get('location') ?? '').value;
        const type = ensure_value(STRING, node.get('type') ?? '').value;
        const comment = ensure_value(STRING, node.get('comment') ?? location + type).value;
        const AI = {
            node,
            location,
            type,
            comment,
        };
        const DB = node.get('DB');
        const input = node.get('input');
        if (!DB && !input) return AI; // 空AI不处理

        AI.DB = make_fake_DB(DB);
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(ret => AI.DB = ret);
        make_s7_expression(
            input,
            {
                document,
                force: { type: 'WORD' },
                default: { comment },
                s7_expr_desc: `${comment} input`,
            },
        ).then(ret => AI.input = ret);

        AI.$zero_raw = nullable_value(INT, node.get('$zero_raw'));
        AI.$span_raw = nullable_value(INT, node.get('$span_raw'));
        AI.$overflow_SP = nullable_value(INT, node.get('$overflow_SP'));
        AI.$underflow_SP = nullable_value(INT, node.get('$underflow_SP'));

        const alarms = make_alarm_props(AI, node, document);
        alarms_list.push(...alarms);
        return AI;
    });
}

export function build_list({ list }) {
    list.forEach(AI => { // 处理配置，形成完整数据
        function make_paras(para_list) {
            const input_paras = [];
            para_list.forEach(_para => {
                const para_name = _para[0];
                const para_SCL = _para[1] ?? para_name;
                const para = AI[para_name];
                if (para) {
                    input_paras.push(`${para_SCL} := ${para.value}`);
                }
            });
            return input_paras;
        }
        AI.input_paras = make_paras([
            ['input', 'AI'],
            ['enable_AH'],
            ['enable_WH'],
            ['enable_WL'],
            ['enable_AL'],
        ]).join(', ');
    });
}

export function gen(AI_list) {
    const rules = [];
    AI_list.forEach(({ document, includes, loop_begin, loop_end, list, options = {} }) => {
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
                loop_begin,
                loop_end,
                list,
                gcl,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_copy_list(item) {
    const src = posix.join(context.module_path, `${NAME}/${NAME}(${item.document.CPU.platform}).scl`);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst }];
}

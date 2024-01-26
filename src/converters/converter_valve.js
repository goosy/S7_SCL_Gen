import { make_s7_expression } from '../symbols.js';
import { BOOL, INT, REAL, STRING, TIME, ensure_value, nullable_value } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7', 'pcs7', 'portal']; // platforms supported by this feature
export const NAME = `Valve_Proc`;
export const LOOP_NAME = 'Valve_Loop';

export function is_feature(feature) {
    return feature.toLowerCase() === 'valve';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}
{{#for valve in list}}{{#if valve.DB}}
// valve 背景块: {{valve.comment}}
DATA_BLOCK {{valve.DB.value}}{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'FALSE' }{{#endif portal}}
AUTHOR : Goosy
FAMILY : GooLib
"{{NAME}}"
BEGIN
    enable_AH := {{valve.$enable_AH}};
    enable_WH := {{valve.$enable_WH}};
    enable_WL := {{valve.$enable_WL}};
    enable_AL := {{valve.$enable_AL}};{{#if valve.$zero_raw !== undefined}}
    zero_raw := {{valve.$zero_raw}};{{#endif}}{{#if valve.$span_raw !== undefined}}
    span_raw := {{valve.$span_raw}};{{#endif}}{{#if valve.$overflow_SP !== undefined}}
    overflow_SP := {{valve.$overflow_SP}};{{#endif}}{{#if valve.$underflow_SP !== undefined}}
    underflow_SP := {{valve.$underflow_SP}};{{#endif}}
    AI := W#16#8000;{{#if valve.remote == null}}
    remote := TRUE;{{#endif}}{{#if valve.$AH_limit !== undefined}}
    AH_limit := {{valve.$AH_limit}};{{#endif}}{{#if valve.$WH_limit !== undefined}}
    WH_limit := {{valve.$WH_limit}};{{#endif}}{{#if valve.$WL_limit !== undefined}}
    WL_limit := {{valve.$WL_limit}};{{#endif}}{{#if valve.$AL_limit !== undefined}}
    AL_limit := {{valve.$AL_limit}};{{#endif}}{{#if valve.$FT_zone !== undefined}}
    FT_zone := {{valve.$FT_zone}};{{#endif}}{{#if valve.$FT_time !== undefined}}
    FT_time := {{valve.$FT_time.DINT}};{{#endif}}{{#if valve.$stop_delay !== undefined}}
    stop_delay := {{valve.$stop_delay.DINT}};{{#endif}}
END_DATA_BLOCK
{{#endif}}{{#endfor valve}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1{{#endif platform}}

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

BEGIN{{#if loop_begin}}
{{loop_begin}}

{{#endif}}{{#for valve in list}}
// {{valve.comment}}{{#if valve.DB}}
{{#if platform != 'portal'}}"{{NAME}}".{{#endif platform
}}{{valve.DB.value}}({{#if valve.enable_AH != undefined}}
    enable_AH := {{valve.enable_AH.value}}, {{#endif}}{{#if valve.enable_WH != undefined}}
    enable_WH := {{valve.enable_WH.value}}, {{#endif}}{{#if valve.enable_WL != undefined}}
    enable_WL := {{valve.enable_WL.value}}, {{#endif}}{{#if valve.enable_AL != undefined}}
    enable_AL := {{valve.enable_AL.value}}, {{#endif}}
    AI := {{#if valve.AI}}{{valve.AI.value}}{{#else}}S7_AI_MIN_WORD{{#endif}}{{#if valve.CP}},
    CP := {{valve.CP.value}}{{#endif}}{{#if valve.OP}},
    OP := {{valve.OP.value}}{{#endif}}{{#if valve.error != null}},
    error := {{valve.error.value}}{{#endif}}{{#if valve.remote != null}},
    remote := {{valve.remote.value}}{{#endif}}{{

#if platform == 'portal'}}{{#if valve.close_action}},
    close_action => {{valve.close_action.value}}{{#endif}}{{#if valve.open_action}},
    open_action => {{valve.open_action.value}}{{#endif}}{{#if valve.stop_action}},
    stop_action => {{valve.stop_action.value}}{{#endif}}{{#if valve.control_action}},
    control_action => {{valve.control_action.value}}{{#endif}});{{

#else platform≠portal}});{{#if valve.close_action}}
{{valve.close_action.value}} := {{valve.DB.value}}.close_action;{{#endif}}{{#if valve.open_action}}
{{valve.open_action.value}} := {{valve.DB.value}}.open_action;{{#endif}}{{#if valve.stop_action}}
{{valve.stop_action.value}} := {{valve.DB.value}}.stop_action;{{#endif}}{{#if valve.control_action}}
{{valve.control_action.value}} := {{valve.DB.value}}.control_action;{{#endif}}{{

#endif platform}}
{{#endif valve.DB}}{{#endfor valve}}{{#if loop_end}}

{{loop_end}}{{#endif}}
END_FUNCTION
`;

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} valve_area
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const valve = {
            node,
            comment: new STRING(node.get('comment') ?? '')
        };
        const comment = valve.comment.value;
        const DB = node.get('DB');
        if (!DB) return valve; // 空valve不处理
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(
            symbol => valve.DB = symbol
        );
        const AI = node.get('AI');
        const _comment = comment ? `${comment} AI` : '';
        make_s7_expression(
            AI,
            {
                document,
                force: { type: 'WORD' },
                default: { comment: _comment },
                s7_expr_desc: `valve ${_comment}`,
            },
        ).then(
            symbol => valve.AI = symbol
        );

        ['AH', 'WH', 'WL', 'AL'].forEach(limit => {
            const enable_str = 'enable_' + limit;
            const $enable_str = '$' + enable_str;
            const $limit_str = '$' + limit + '_limit';
            // as ex: valve.$AH_limit
            valve[$limit_str] = nullable_value(REAL, node.get($limit_str));
            // as ex: valve.$enable_AH
            valve[$enable_str] = ensure_value(BOOL, node.get($enable_str) ?? valve[$limit_str] != null);
            // as ex: valve.enable_AH
            make_s7_expression(
                node.get(enable_str),
                {
                    document,
                    force: { type: 'BOOL' },
                    s7_expr_desc: `valve ${comment} ${enable_str}`,
                },
            ).then(
                symbol => valve[enable_str] = symbol
            );
        });

        ['CP', 'OP', 'error', 'remote', 'close_action', 'open_action', 'stop_action', 'control_action'].forEach(prop => {
            const _comment = comment ? `${comment} ${prop}` : '';
            const value = node.get(prop);
            if (value !== undefined) make_s7_expression(
                value,
                {
                    document,
                    force: { type: 'BOOL' },
                    default: { comment: _comment },
                    s7_expr_desc: `valve ${comment} ${prop}`,
                },
            ).then(
                symbol => valve[prop] = symbol
            );
        });

        valve.$zero_raw = nullable_value(INT, node.get('$zero_raw'));
        valve.$span_raw = nullable_value(INT, node.get('$span_raw'));
        valve.$overflow_SP = nullable_value(INT, node.get('$overflow_SP'));
        valve.$underflow_SP = nullable_value(INT, node.get('$underflow_SP'));
        valve.$FT_zone = nullable_value(REAL, node.get('$FT_zone'));
        valve.$FT_time = nullable_value(TIME, node.get('$FT_time'));
        valve.$stop_delay = nullable_value(TIME, node.get('$stop_delay'));

        return valve;
    });
}

export function gen(valve_list) {
    const rules = [];

    valve_list.forEach(({ document, includes, loop_begin, loop_end, list }) => {
        const { CPU, gcl } = document;
        const { output_dir, platform } = CPU;
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
                platform,
                includes,
                loop_begin,
                loop_end,
                NAME,
                LOOP_NAME,
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
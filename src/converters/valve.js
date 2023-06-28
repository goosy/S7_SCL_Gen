import { make_s7express } from '../symbols.js';
import { BOOL, REAL, STRING, ensure_value, nullable_value } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7', 'pcs7', 'portal'];
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
    enable_AL := {{valve.$enable_AL}};
    AI := W#16#8000;{{#if valve.remote == null}}
    remote := TRUE;{{#endif}}
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

BEGIN{{#for valve in list}}
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

#if platform == 'step7'}});{{#if valve.close_action}}
{{valve.close_action.value}} := "{{valve.DB.name}}".close_action;{{#endif}}{{#if valve.open_action}}
{{valve.open_action.value}} := "{{valve.DB.name}}".open_action;{{#endif}}{{#if valve.stop_action}}
{{valve.stop_action.value}} := "{{valve.DB.name}}".stop_action;{{#endif}}{{

#else platform == 'portal'}}{{#if valve.close_action}},
    close_action    => {{valve.close_action.value}}{{#endif}}{{#if valve.open_action}},
    open_action  => {{valve.open_action.value}}{{#endif}}{{#if valve.stop_action}},
    stop_action   => {{valve.stop_action.value}}{{#endif}});{{

#endif platform}}
{{#endif valve.DB}}{{#endfor valve}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
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
        make_s7express(valve, 'DB', DB, document, { force: { type: NAME }, default: { comment } });
        const AI = node.get('AI');
        make_s7express(valve, 'AI', AI, document, {
            s7express: true,
            force: { type: 'WORD' },
            default: { comment: comment ? `${comment} AI` : '' }
        });

        ['AH', 'WH', 'WL', 'AL'].forEach(limit => {
            const enable_str = 'enable_' + limit;
            const $enable_str = '$' + enable_str;
            const $limit_str = '$' + limit + '_limit';
            // as ex: valve.$AH_limit
            valve[$limit_str] = nullable_value(REAL, node.get($limit_str));
            // as ex: valve.$enable_AH
            valve[$enable_str] = ensure_value(BOOL, node.get($enable_str) ?? valve[$limit_str] != null);
            // as ex: valve.enable_AH
            make_s7express(valve, enable_str, node.get(enable_str), document, {
                s7express: true,
                force: { type: 'BOOL' },
            });
        });

        function make_bool_s7s(prop) {
            const _comment = comment ? `${comment} ${prop}` : '';
            const value = node.get(prop);
            if (value !== undefined) make_s7express(valve, prop, value, document, {
                s7express: true,
                force: { type: 'BOOL' },
                default: { comment: _comment }
            });
        }
        ['CP', 'OP', 'error', 'remote', 'close_action', 'open_action', 'stop_action'].forEach(make_bool_s7s);

        return valve;
    });
}

export function gen(valve_list) {
    const rules = [];

    valve_list.forEach(({ document, includes, loop_additional_code, list }) => {
        const { CPU, gcl } = document;
        const { output_dir, platform } = CPU;
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
                platform,
                includes,
                loop_additional_code,
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
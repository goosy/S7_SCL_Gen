import { make_prop_symbolic } from '../symbols.js';
import { STRING } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7'];
export const NAME = `Valve_Proc`;
export const LOOP_NAME = 'Valve_Loop';

export function is_feature(feature) {
    return feature.toLowerCase() === 'valve';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID

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
"{{NAME}}".{{valve.DB.value}}(
    AI := {{#if valve.AI}}{{valve.AI.value}}{{#else}}S7_AI_MIN_WORD{{#endif}}{{#if valve.CP}},
    CP := {{valve.CP.value}}{{#endif}}{{#if valve.OP}},
    OP := {{valve.OP.value}}{{#endif}}{{#if valve.error}},
    error := {{valve.error.value}}{{#endif}}{{#if valve.remote}},
    remote := {{valve.remote.value}}{{#endif}});{{#if valve.close_action}}
{{valve.close_action.value}} := "{{valve.DB.name}}".close_action;{{#endif}}{{#if valve.open_action}}
{{valve.open_action.value}} := "{{valve.DB.name}}".open_action;{{#endif}}{{#if valve.stop_action}}
{{valve.stop_action.value}} := "{{valve.DB.name}}".stop_action;{{#endif}}
{{#endif}}{{#endfor valve}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} valve_area
 * @returns {void}
 */
export function parse_symbols(area) {
    const document = area.document;
    const list = area.list.map(item => item.toJSON());
    area.list = list;
    list.forEach(valve => {
        if (!valve.DB) return; // 空valve不处理
        valve.comment = new STRING(valve.comment ?? '');
        const comment = valve.comment.value;
        function symbolic(type, _comment) {
            return function (prop) {
                let comment = null;
                if (_comment) comment = `${_comment} ${prop}`;
                const options = {
                    document,
                    force: { type },
                    default: { comment }
                };
                make_prop_symbolic(valve, prop, document, options);
            }
        }
        symbolic(NAME, comment)('DB');
        symbolic('WORD', comment)('AI');
        ['CP', 'OP', 'error', 'remote', 'close_action', 'open_action', 'stop_action'].forEach(symbolic('BOOL', comment));
    });
}

export function gen(valve_list) {
    const rules = [];

    valve_list.forEach(({ document, includes, loop_additional_code, list }) => {
        const { CPU, gcl } = document;
        const { output_dir } = CPU;
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
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
    const filename = `${NAME}.scl`;
    const src = posix.join(context.module_path, NAME, filename);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, filename);
    return [{ src, dst }];
}
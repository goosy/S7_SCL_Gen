import { make_prop_symbolic } from "../symbols.js";
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7'];
export const NAME = 'PV_Alarm';
export const LOOP_NAME = 'PV_Loop';
export const BUILDIN = `
- [${NAME}, FB519, ${NAME}, PV_Alarm main FB]
- [${LOOP_NAME}, FC519, ${LOOP_NAME}, main PV_Alarm cyclic call function]
`;

export function is_type(type) {
    return type.toUpperCase() === 'PV_ALARM' || type.toUpperCase() === 'PVALARM' || type.toUpperCase() === 'PV';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
{{#for PV_item in list}}{{#if PV_item.DB}}
// PV_Alarm 背景块：{{PV_item.comment}}
DATA_BLOCK "{{PV_item.DB.name}}" "{{NAME}}"
BEGIN{{#if PV_item.$enable_alarm != null}}
    enable_alarm := {{PV_item.$enable_alarm}};{{#endif}}{{#if PV_item.$AH_limit != null}}
    AH_limit := {{PV_item.$AH_limit}};{{#endif}}{{#if PV_item.$WH_limit != null}}
    WH_limit := {{PV_item.$WH_limit}};{{#endif}}{{#if PV_item.$WL_limit != null}}
    WL_limit := {{PV_item.$WL_limit}};{{#endif}}{{#if PV_item.$AL_limit != null}}
    AL_limit := {{PV_item.$AL_limit}};{{#endif}}{{#if PV_item.$dead_zone != null}}
    dead_zone := {{PV_item.$dead_zone}};{{#endif}}{{#if PV_item.$FT_time != null}}
    FT_time := L#{{PV_item.$FT_time}};{{#endif}}
END_DATA_BLOCK
{{#endif}}{{#endfor PV_item}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#for PV_item in list}}
{{#if PV_item.DB}}"{{NAME}}"."{{PV_item.DB.name}}"(PV := {{PV_item.input.value}}{{#if PV_item.enable_alarm != undefined}}, enable_alarm := {{PV_item.enable_alarm}}{{#endif}}); // {{PV_item.comment}}{{#endif}}{{#endfor PV_item}}
{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

/**
 * 第一遍扫描 提取符号
 * @date 2022-1-17
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols({ CPU, list }) {
    const document = CPU.PV;
    list.forEach(PV => {
        if (!PV.DB) return; // 空PV不处理
        if (Array.isArray(PV.DB)) PV.DB[3] ??= PV.comment;
        make_prop_symbolic(PV, 'DB', CPU, { document, default_type: NAME });
        make_prop_symbolic(PV, 'input', CPU, { document, default_type: 'REAL' });
    });
}

export function gen(PV_list) {
    const rules = [];
    PV_list.forEach(({ CPU, includes, loop_additional_code, list, options = {} }) => {
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
    const filename = `${NAME}.scl`;
    const src = posix.join(context.module_path, NAME, filename);
    const dst = posix.join(context.work_path, item.CPU.output_dir, filename);
    return [{ src, dst }];
}

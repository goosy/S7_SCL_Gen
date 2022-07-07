import { make_prop_symbolic } from "../symbols.js";
import { join } from 'path';

export const PV_NAME = 'PV_Alarm';
export const PV_LOOP_NAME = 'PV_Loop';
export const PV_BUILDIN = [
    [PV_NAME, 'FB519', PV_NAME, 'PV_Alarm main FB'],
    [PV_LOOP_NAME, "FC519", PV_LOOP_NAME, 'main PV_Alarm cyclic call function'],
];

export function is_type_PV(type) {
    return type.toUpperCase() === 'PV_ALARM' || type.toUpperCase() === 'PVALARM' || type.toUpperCase() === 'PV';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
{{#for PV_item in list}}{{#if PV_item.DB}}
// PV_Alarm 背景块：{{PV_item.comment}}
DATA_BLOCK "{{PV_item.DB.name}}" "{{PV_NAME}}"
BEGIN{{#if PV_item.enable_alarm != undefined}}
    enable_alarm := {{PV_item.enable_alarm}};{{#endif}}{{#if PV_item.AH_limit}}
    AH_limit := {{PV_item.AH_limit}};{{#endif}}{{#if PV_item.WH_limit}}
    WH_limit := {{PV_item.WH_limit}};{{#endif}}{{#if PV_item.WL_limit}}
    WL_limit := {{PV_item.WL_limit}};{{#endif}}{{#if PV_item.AL_limit}}
    AL_limit := {{PV_item.AL_limit}};{{#endif}}{{#if PV_item.dead_zone}}
    dead_zone := {{PV_item.dead_zone}};{{#endif}}{{#if PV_item.FT_time}}
    FT_time := L#{{PV_item.FT_time}};{{#endif}}
END_DATA_BLOCK
{{#endif}}{{#endfor PV_item}}

// 主循环调用
FUNCTION "PV_Loop" : VOID{{#for PV_item in list}}
{{#if PV_item.DB}}"{{PV_NAME}}"."{{PV_item.DB.name}}"(PV := {{PV_item.input.value}});  {{#endif}}// {{PV_item.comment}}{{#endfor PV_item}}
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
export function parse_symbols_PV({ CPU, list }) {
    const document = CPU.PV;
    list.forEach(PV => {
        if (!PV.DB) return; // 空PV不处理
        make_prop_symbolic(PV, 'DB', CPU, { document, range: [0, 0, 0], default_type: PV_NAME });
        make_prop_symbolic(PV, 'input', CPU, { document, range: [0, 0, 0], default_type: 'REAL' });
    });
}

export function gen_PV(PV_list) {
    const rules = [];
    PV_list.forEach(({ CPU, includes, loop_additional_code, list, options = {} }) => {
        const { name, output_dir } = CPU;
        const { output_file = PV_LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                PV_NAME,
                name,
                includes,
                loop_additional_code,
                list,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_PV_copy_list(item) {
    const output_dir = item.CPU.output_dir;
    return [{
        src: `PV_Alarm/${PV_NAME}.scl`,
        dst: `${output_dir}/${PV_NAME}.scl`,
        desc: `${join(process.cwd(), output_dir, PV_NAME)}.scl`,
    }];
}

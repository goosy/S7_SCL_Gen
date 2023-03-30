import { make_prop_symbolic } from "../symbols.js";
import { context } from '../util.js';
import { BOOL, INT, REAL, STRING, nullable_typed_value } from '../value.js';
import { posix } from 'path';

export const platforms = ['step7'];
export const NAME = 'PV_Alarm';
export const LOOP_NAME = 'PV_Loop';

export function is_feature(feature) {
    return feature.toUpperCase() === 'PV_ALARM' || feature.toUpperCase() === 'PVALARM' || feature.toUpperCase() === 'PV';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}
{{#for PV_item in list}}{{#if PV_item.DB && PV_item.input}}
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
{{#endif PV_item.}}{{#endfor PV_item}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#for PV_item in list}}
{{#if PV_item.DB && PV_item.input}}"{{NAME}}"."{{PV_item.DB.name}}"(PV := {{PV_item.input.value}}{{#if PV_item.enable_alarm != undefined}}, enable_alarm := {{PV_item.enable_alarm.value}}{{#endif}}); {{#endif PV_item.}}// {{PV_item.comment}}{{#endfor PV_item}}
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
export function parse_symbols(area) {
    const document = area.document;
    const list = area.list.map(item => item.toJSON());
    area.list = list;
    list.forEach(PV => {
        if (!PV.DB && !PV.input) return; // 空PV不处理
        if (!PV.DB || !PV.input) throw new Error(`PV 功能中 DB 和 input 不能只定义1个!`);
        PV.comment = new STRING(PV.comment ?? '');
        const comment = PV.comment.value;
        make_prop_symbolic(PV, 'DB', document, { force: { type: NAME }, default: { comment } });
        make_prop_symbolic(PV, 'input', document, { force: { type: 'REAL' }, default: { comment } });
        make_prop_symbolic(PV, 'enable_alarm', document, { force: { type: 'BOOL' } });
        PV.$enable_alarm = nullable_typed_value(BOOL, PV.$enable_alarm);
        PV.$AH_limit = nullable_typed_value(REAL, PV.$AH_limit);
        PV.$WH_limit = nullable_typed_value(REAL, PV.$WH_limit);
        PV.$WL_limit = nullable_typed_value(REAL, PV.$WL_limit);
        PV.$AL_limit = nullable_typed_value(REAL, PV.$AL_limit);
        PV.$dead_zone = nullable_typed_value(REAL, PV.$dead_zone);
        PV.$FT_time = nullable_typed_value(INT, PV.$FT_time);
    });
}

export function gen(PV_list) {
    const rules = [];
    PV_list.forEach(({ document, includes, loop_additional_code, list, options = {} }) => {
        const { CPU, gcl } = document;
        const { output_dir } = CPU;
        const { output_file = LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                NAME,
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
    const filename = `${NAME}.scl`;
    const src = posix.join(context.module_path, NAME, filename);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, filename);
    return [{ src, dst }];
}

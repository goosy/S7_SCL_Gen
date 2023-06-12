import { make_s7express } from "../symbols.js";
import { context } from '../util.js';
import { BOOL, DINT, REAL, STRING, nullable_value } from '../value.js';
import { posix } from 'path';

export const platforms = ['step7'];
export const NAME = 'PV_Alarm';
export const LOOP_NAME = 'Alarm_Loop';

export function is_feature(feature) {
    const name = feature.toUpperCase();
    return name === 'ALARM' || name === 'PV_ALARM' || name === 'PV' || name === 'PVALARM';
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
    FT_time := {{PV_item.$FT_time}};{{#endif}}
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
export function initialize_list(area) {
    const document = area.document;
    const gcl = document.gcl;
    area.list = area.list.map(node => {
        const PV = {
            node,
            comment: new STRING(node.get('comment') ?? '')
        };
        const DB = node.get('DB');
        const input = node.get('input');
        if (!DB && !input) return PV; // 空PV不处理
        if (!DB || !input) throw new Error(`PV 功能中 DB 和 input 不能只定义1个:`);
        let info = gcl.get_pos_info(...node.range);

        const comment = PV.comment.value;
        make_s7express(PV, 'DB', DB, document, { force: { type: NAME }, default: { comment } });
        make_s7express(PV, 'input', input, document, {
            s7express: true,
            force: { type: 'REAL' },
            default: { comment }
        });
        const enable_alarm = node.get('enable_alarm');
        make_s7express(PV, 'enable_alarm', enable_alarm, document, {
            s7express: true,
            force: { type: 'BOOL' },
        });

        PV.$enable_alarm = nullable_value(BOOL, node.get('$enable_alarm'));
        PV.$AH_limit = nullable_value(REAL, node.get('$AH_limit'));
        PV.$WH_limit = nullable_value(REAL, node.get('$WH_limit')) ?? PV.$AH_limit;
        PV.$AL_limit = nullable_value(REAL, node.get('$AL_limit'));
        PV.$WL_limit = nullable_value(REAL, node.get('$WL_limit')) ?? PV.$AL_limit;
        PV.$AH_limit ??= 100.0;
        PV.$WH_limit ??= 100.0;
        PV.$WL_limit ??= 0.0;
        PV.$AL_limit ??= 0.0;
        if (
            PV.$WH_limit > PV.$AH_limit ||
            PV.$WL_limit > PV.$WH_limit ||
            PV.$AL_limit > PV.$WL_limit
        ) throw new Error(`the values of limitation were wrong 定义的限制值有错误\n${info}`);
        PV.$dead_zone = nullable_value(REAL, node.get('$dead_zone'));
        PV.$FT_time = nullable_value(DINT, node.get('$FT_time'));

        return PV;
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

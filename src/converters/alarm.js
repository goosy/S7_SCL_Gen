import { make_s7express } from "../symbols.js";
import { context } from '../util.js';
import { BOOL, DINT, REAL, STRING, nullable_value, ensure_value } from '../value.js';
import { posix } from 'path';

export const platforms = ['step7', 'portal', 'pcs7'];
export const NAME = 'Alarm_Proc';
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
// Alarm_Proc 背景块：{{PV_item.comment}}
DATA_BLOCK {{PV_item.DB.value}}{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'FALSE' }{{#endif portal}}
AUTHOR : Goosy
FAMILY : GooLib
"{{NAME}}"
BEGIN
    enable_AH := {{PV_item.$enable_AH}};
    enable_WH := {{PV_item.$enable_WH}};
    enable_WL := {{PV_item.$enable_WL}};
    enable_AL := {{PV_item.$enable_AL}};{{#if PV_item.$AH_limit != null}}
    AH_limit := {{PV_item.$AH_limit}};{{#endif}}{{#if PV_item.$WH_limit != null}}
    WH_limit := {{PV_item.$WH_limit}};{{#endif}}{{#if PV_item.$WL_limit != null}}
    WL_limit := {{PV_item.$WL_limit}};{{#endif}}{{#if PV_item.$AL_limit != null}}
    AL_limit := {{PV_item.$AL_limit}};{{#endif}}{{#if PV_item.$dead_zone != null}}
    dead_zone := {{PV_item.$dead_zone}};{{#endif}}{{#if PV_item.$FT_time != null}}
    FT_time := {{PV_item.$FT_time}};{{#endif}}
END_DATA_BLOCK
{{#endif PV_item.}}{{#endfor PV_item}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1{{#endif platform}}
BEGIN{{#for PV_item in list}}
{{#if PV_item.DB && PV_item.input}}{{#if platform == 'step7' || platform == 'pcs7'
}}"{{NAME}}".{{#endif platform
}}{{PV_item.DB.value}}(PV := {{PV_item.input.value}}{{
    #if PV_item.enable_AH != undefined}}, enable_AH := {{PV_item.enable_AH.value}}{{#endif}}{{
    #if PV_item.enable_WH != undefined}}, enable_WH := {{PV_item.enable_WH.value}}{{#endif}}{{
    #if PV_item.enable_WL != undefined}}, enable_WL := {{PV_item.enable_WL.value}}{{#endif}}{{
    #if PV_item.enable_AL != undefined}}, enable_AL := {{PV_item.enable_AL.value}}{{#endif
    }}); {{#endif PV_item.}}// {{PV_item.comment}}{{#endfor PV_item}}
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
        ['AH', 'WH', 'WL', 'AL'].forEach(limit => {
            const enable_str = 'enable_' + limit;
            const $enable_str = '$' + enable_str;
            const $limit_str = '$' + limit + '_limit';
            // as ex: PV.$AH_limit
            PV[$limit_str] = nullable_value(REAL, node.get($limit_str));
            // as ex: PV.$enable_AH
            PV[$enable_str] = ensure_value(BOOL, node.get($enable_str) ?? PV[$limit_str] != null);
            // as ex: PV.enable_AH
            make_s7express(PV, enable_str, node.get(enable_str), document, {
                s7express: true,
                force: { type: 'BOOL' },
            });
        });

        // limitation validity check
        const AH = PV.$AH_limit ?? PV.$WH_limit ?? PV.$WL_limit ?? PV.$AL_limit;
        const WH = PV.$WH_limit ?? AH;
        const WL = PV.$WL_limit ?? WH;
        const AL = PV.$AL_limit ?? WL;
        if (WH > AH || WL > WH || AL > WL)
            throw new Error(`the values of limitation were wrong 定义的限制值有错误\n${info}`);
        PV.$dead_zone = nullable_value(REAL, node.get('$dead_zone'));
        PV.$FT_time = nullable_value(DINT, node.get('$FT_time'));

        return PV;
    });
}

export function gen(PV_list) {
    const rules = [];
    PV_list.forEach(({ document, includes, loop_additional_code, list, options = {} }) => {
        const { CPU, gcl } = document;
        const { output_dir, platform } = CPU;
        const { output_file = LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                NAME,
                LOOP_NAME,
                platform,
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
    const src = posix.join(context.module_path, NAME, `${NAME}(${item.document.CPU.platform}).scl`);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst }];
}

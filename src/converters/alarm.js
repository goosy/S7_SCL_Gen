import { make_s7express } from "../symbols.js";
import { context } from '../util.js';
import { BOOL, REAL, STRING, TIME, nullable_value, ensure_value } from '../value.js';
import { posix } from 'path';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
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
{{#for alarm in list}}{{#if alarm.DB}}
// Alarm_Proc 背景块：{{alarm.comment}}
DATA_BLOCK {{alarm.DB.value}}{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'FALSE' }{{#endif portal}}
AUTHOR : Goosy
FAMILY : GooLib
"{{NAME}}"
BEGIN
    enable_AH := {{alarm.$enable_AH}};
    enable_WH := {{alarm.$enable_WH}};
    enable_WL := {{alarm.$enable_WL}};
    enable_AL := {{alarm.$enable_AL}};{{#if alarm.$zero !== undefined}}
    zero := {{alarm.$zero}};{{#endif}}{{#if alarm.$span !== undefined}}
    span := {{alarm.$span}};{{#endif}}{{#if alarm.$AH_limit != null}}
    AH_limit := {{alarm.$AH_limit}};{{#endif}}{{#if alarm.$WH_limit != null}}
    WH_limit := {{alarm.$WH_limit}};{{#endif}}{{#if alarm.$WL_limit != null}}
    WL_limit := {{alarm.$WL_limit}};{{#endif}}{{#if alarm.$AL_limit != null}}
    AL_limit := {{alarm.$AL_limit}};{{#endif}}{{#if alarm.$dead_zone != null}}
    dead_zone := {{alarm.$dead_zone}};{{#endif}}{{#if alarm.$FT_time != null}}
    FT_time := {{alarm.$FT_time.DINT}};{{#endif}}
END_DATA_BLOCK
{{#endif alarm.DB}}{{#endfor alarm}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1{{#endif platform}}
BEGIN{{#if loop_begin}}
{{loop_begin}}
{{#endif}}{{#for alarm in list}}
{{

#if alarm.DB && alarm.input_paras}}{{#if platform == 'step7' || platform == 'pcs7'
}}"{{NAME}}".{{#endif platform
}}{{alarm.DB.value}}({{alarm.input_paras}}); {{#endif alarm invoke

}}// {{alarm.comment}}{{#endfor alarm}}{{#if loop_end}}

{{loop_end}}{{#endif}}
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
        const alarm = {
            node,
            comment: new STRING(node.get('comment') ?? '')
        };
        const DB = node.get('DB');
        const input = node.get('input');
        if (!DB && !input) return alarm; // 空alarm不处理
        let info = gcl.get_pos_info(...node.range);

        const comment = alarm.comment.value;
        make_s7express(alarm, 'DB', DB, document, { force: { type: NAME }, default: { comment } });
        make_s7express(alarm, 'input', input, document, {
            s7express: true,
            force: { type: 'REAL' },
            default: { comment }
        });
        alarm.$zero = nullable_value(REAL, node.get('$zero')) ?? new REAL(0);
        alarm.$span = nullable_value(REAL, node.get('$span')) ?? new REAL(100);
        const invalid = node.get('invalid');
        make_s7express(alarm, 'invalid', invalid, document, {
            s7express: true,
            force: { type: 'BOOL' },
            default: { comment }
        });
        ['AH', 'WH', 'WL', 'AL'].forEach(limit => {
            const enable_str = 'enable_' + limit;
            const $enable_str = '$' + enable_str;
            const $limit_str = '$' + limit + '_limit';
            // as ex: alarm.$AH_limit
            alarm[$limit_str] = nullable_value(REAL, node.get($limit_str));
            // as ex: alarm.$enable_AH
            alarm[$enable_str] = ensure_value(BOOL, node.get($enable_str) ?? alarm[$limit_str] != null);
            // as ex: alarm.enable_AH
            make_s7express(alarm, enable_str, node.get(enable_str), document, {
                s7express: true,
                force: { type: 'BOOL' },
            });
        });

        // limitation validity check
        const AH = alarm.$AH_limit ?? alarm.$WH_limit ?? alarm.$WL_limit ?? alarm.$AL_limit;
        const WH = alarm.$WH_limit ?? AH;
        const WL = alarm.$WL_limit ?? WH;
        const AL = alarm.$AL_limit ?? WL;
        if (WH > AH || WL > WH || AL > WL)
            throw new Error(`the values of limitation were wrong 定义的限制值有错误\n${info}`);
        alarm.$dead_zone = nullable_value(REAL, node.get('$dead_zone'));
        alarm.$FT_time = nullable_value(TIME, node.get('$FT_time'));

        return alarm;
    });
}

export function build_list({ list }) {
    list.forEach(alarm => { // 处理配置，形成完整数据
        function make_paras(para_list) {
            const input_paras = [];
            para_list.forEach(_para => {
                const para_name = _para[0];
                const para_SCL = _para[1] ?? para_name;
                const para = alarm[para_name];
                if (para) {
                    input_paras.push(`${para_SCL} := ${para.value}`);
                }
            });
            return input_paras;
        }
        alarm.input_paras = make_paras([
            ['input', 'PV'],
            ['invalid'],
            ['enable_AH'],
            ['enable_WH'],
            ['enable_WL'],
            ['enable_AL'],
        ]).join(', ');
    });
}

export function gen(alarm_list) {
    const rules = [];
    alarm_list.forEach(({ document, includes, loop_begin, loop_end, list, options = {} }) => {
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
    const src = posix.join(context.module_path, NAME, `${NAME}(${item.document.CPU.platform}).scl`);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst }];
}

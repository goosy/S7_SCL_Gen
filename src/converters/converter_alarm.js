import { make_s7_expression } from "../symbols.js";
import { context } from '../util.js';
import { STRING, ensure_value } from '../s7data.js';
import { posix } from 'path';
import { make_alarm_props, make_fake_DB } from './alarm_common.js';

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
{{if includes}}
{{  includes}}
{{endif}}_
{{for alarm in list}}_
{{if alarm.DB}}
// Alarm_Proc 背景块：{{alarm.comment}}
DATA_BLOCK {{alarm.DB.value}}
{{if platform == 'portal'}}_
{ S7_Optimized_Access := 'FALSE' }
{{endif // portal}}_
AUTHOR : Goosy
FAMILY : GooLib
"{{NAME}}"
BEGIN
    enable_AH := {{alarm.$enable_AH}};
    enable_WH := {{alarm.$enable_WH}};
    enable_WL := {{alarm.$enable_WL}};
    enable_AL := {{alarm.$enable_AL}};
{{if alarm.$zero !== undefined}}_
    zero := {{alarm.$zero}};
{{endif}}_
{{if alarm.$span !== undefined}}_
    span := {{alarm.$span}};
{{endif}}_
{{if alarm.$AH_limit != null}}_
    AH_limit := {{alarm.$AH_limit}};
{{endif}}_
{{if alarm.$WH_limit != null}}_
    WH_limit := {{alarm.$WH_limit}};
{{endif}}_
{{if alarm.$WL_limit != null}}_
    WL_limit := {{alarm.$WL_limit}};
{{endif}}_
{{if alarm.$AL_limit != null}}_
    AL_limit := {{alarm.$AL_limit}};
{{endif}}_
{{if alarm.$dead_zone != null}}_
    dead_zone := {{alarm.$dead_zone}};
{{endif}}_
{{if alarm.$FT_time != null}}_
    FT_time := {{alarm.$FT_time.DINT}};
{{endif}}_
END_DATA_BLOCK
{{endif // alarm.DB}}_
{{endfor // alarm}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID
{{if platform == 'portal'}}_
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
{{endif // platform}}_
BEGIN
{{if loop_begin}}_
{{  loop_begin}}

{{endif}}_
{{for alarm in list}}_
{{if alarm.DB}}_
{{  if platform == 'step7' || platform == 'pcs7'}}_
"{{NAME}}".{{// 非博途平台必须有FB块名}}_
{{  endif // platform}}_
{{  alarm.DB.value}}({{alarm.input_paras}}); {{}}_
{{endif // alarm.DB}}// {{alarm.comment}}
{{endfor // alarm}}_
{{if loop_end}}
{{  loop_end}}
{{endif}}_
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
    const alarms_list = document.CPU.alarms_list;
    area.list = area.list.map(node => {
        const location = ensure_value(STRING, node.get('location') ?? '').value;
        const type = ensure_value(STRING, node.get('type') ?? '').value;
        const comment = ensure_value(STRING, node.get('comment') ?? location + type).value;
        const alarm = {
            node,
            location,
            type,
            comment,
        };
        const DB = node.get('DB');
        const input = node.get('input');
        if (!DB && !input) return alarm; // 空alarm不处理

        alarm.DB = make_fake_DB(DB);
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(ret => alarm.DB = ret);
        make_s7_expression(
            input,
            {
                document,
                force: { type: 'REAL' },
                default: { comment },
                s7_expr_desc: `AI ${comment} input`,
            },
        ).then(ret => alarm.input = ret);
        const invalid = node.get('invalid');
        make_s7_expression(
            invalid,
            {
                document,
                force: { type: 'BOOL' },
                default: { comment },
                s7_expr_desc: `AI ${comment} invalid`,
            },
        ).then(ret => alarm.invalid = ret);

        const alarms = make_alarm_props(alarm, node, document);
        alarms_list.push(...alarms);

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

export function gen({ document, includes, loop_begin, loop_end, list, options = {} }) {
    const { CPU, gcl } = document;
    const { output_dir, platform } = CPU;
    const { output_file = LOOP_NAME } = options;
    const rules = [{
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
    }];
    return [{ rules, template }];
}

export function gen_copy_list(item) {
    const src = posix.join(context.module_path, NAME, `${NAME}(${item.document.CPU.platform}).scl`);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst }];
}

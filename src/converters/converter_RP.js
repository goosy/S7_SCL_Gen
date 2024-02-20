import { make_s7_expression } from '../symbols.js';
import { context } from '../util.js';
import { STRING, ensure_value, TIME } from '../s7data.js';
import { posix } from 'path';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const CP_NAME = 'CP';
export const DP_NAME = 'DP';
export const LOOP_NAME = 'RP_Loop';

export function is_feature(name) {
    name = name.toLowerCase();
    return name === 'rp' || name === 'relay' || name === 'pulse';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{#if includes}}
{{includes}}
{{#endif}}_
{{#for RP in list}}
// RP背景块: {{RP.comment}}
DATA_BLOCK {{RP.DB.value}}
{{#if platform == 'portal'}}_
{ S7_Optimized_Access := 'FALSE' }
{{#else}}_
{ S7_m_c := 'true' }
{{#endif portal}}_
AUTHOR:Goosy
FAMILY:GooLib
"{{RP.FB}}"
BEGIN
{{#if RP.$PT != undefined}}_
    PT := {{RP.$PT}}; // 脉冲时长
{{#endif RP.$PT}}_
{{#if RP.IncludeFallingEdge != undefined}}_
    IncludeFallingEdge := {{RP.IncludeFallingEdge}}; // 是否包含下降沿
{{#endif RP.IncludeFallingEdge}}_
END_DATA_BLOCK
{{#endfor RP}}_

FUNCTION "{{LOOP_NAME}}" : VOID
{{#if platform == 'portal'}}_
{ S7_Optimized_Access := 'TRUE' }
{{#endif portal}}_
// 主循环
BEGIN
{{#if loop_begin}}_
{{loop_begin}}

{{#endif}}_
{{#for RP in list}}_
{{#if platform == 'step7' || platform == 'pcs7'}}"{{RP.FB}}".{{#endif platform}}_
{{RP.DB.value}}(IN := {{RP.IN.value}}_
{{#if RP.PT != undefined}}, PT := {{RP.PT}}{{#endif}}); // {{RP.comment}}
{{#endfor RP}}_
{{#if loop_end}}
{{loop_end}}
{{#endif}}_
END_FUNCTION
`

const FB_dict = {
    onDelay: 'TON',
    offDelay: 'TOF',
    onPulse: 'TP',
    onDPulse: 'DP',
    changePulse: 'CP',
    changeDPulse: 'DP',
}

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const RP = {
            node,
            comment: new STRING(node.get('comment') ?? '信号近期有变化')
        };
        RP.type = ensure_value(STRING, node.get('type'));
        if (!Object.keys(FB_dict).includes(RP.type?.value)) {
            throw new SyntaxError(`${document.CPU.name}:RP (${comment}) 的类型 "${RP.type}" 不支持`);
        };
        RP.FB = FB_dict[RP.type.value];
        const DB = node.get('DB');
        if (!DB) throw new SyntaxError("RP转换必须有DB块!");
        const comment = RP.comment.value;
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: RP.FB },
                default: { comment },
            },
        ).then(
            symbol => RP.DB = symbol
        );
        make_s7_expression(
            node.get('input'),
            {
                document,
                force: { type: 'BOOL' },
                default: { comment },
                s7_expr_desc: `RP ${comment} input`,
            },
        ).then(
            symbol => RP.IN = symbol
        );
        make_s7_expression(
            node.get('output'),
            {
                document,
                force: { type: 'BOOL' },
                default: { comment },
                s7_expr_desc: `RP ${comment} output`,
            },
        ).then(
            symbol => RP.Q = symbol
        );
        if (RP.type.value === 'onDPulse' || RP.type.value === 'changeDPulse') {
            RP.IncludeFallingEdge = RP.type.value === 'changeDPulse';
        }
        RP.$PT = ensure_value(TIME, node.get('$time') ?? 0);
        // @TODO 增加运行时PT的符号输入
        // RP.PT = ensure_value(TIME, node.get('time') ?? 0);

        return RP;
    });
}

export function gen({ document, includes, loop_begin, loop_end, list }) {
    const { CPU, gcl } = document;
    const { output_dir, platform } = CPU;
    const rules = [{
        "name": `${output_dir}/${LOOP_NAME}.scl`,
        "tags": {
            platform,
            includes,
            loop_begin,
            loop_end,
            LOOP_NAME,
            list,
            gcl,
        }
    }];
    return [{ rules, template }];
}

export function gen_copy_list(item) {
    function gen_copy_pair(filename) {
        const src = posix.join(context.module_path, 'RP_Trigger', filename);
        const dst = posix.join(context.work_path, item.document.CPU.output_dir, filename);
        return { src, dst };
    }

    return [
        gen_copy_pair(`${CP_NAME}.scl`),
        gen_copy_pair(`${DP_NAME}.scl`)
    ];
}

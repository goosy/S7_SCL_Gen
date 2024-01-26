import { make_s7_expression } from '../symbols.js';
import { STRING } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = `Timer_Proc`;
export const LOOP_NAME = 'Timer_Loop';

export function is_feature(feature) {
    return feature.toLowerCase() === 'timer';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}
{{#if platform == 'portal'}}{{#for timer in list}}{{#if timer.DB}}
// timer背景块: {{timer.comment}}
DATA_BLOCK {{timer.DB.value}}
{ S7_Optimized_Access := 'FALSE' }
AUTHOR : Goosy
FAMILY : GooLib
"{{NAME}}"
BEGIN
END_DATA_BLOCK
{{#endif timer.}}{{#endfor timer}}{{#endif portal}}
// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }{{#endif portal}}
// 计时主循环
BEGIN{{#if loop_begin}}
{{loop_begin}}

{{#endif}}{{#for timer in list}}
// {{timer.comment}}
{{#if platform != 'portal'}}"{{NAME}}".{{#endif platform
}}{{timer.DB.value}}({{#if timer.enable}}
    enable := {{timer.enable.value}},{{#endif}}{{#if timer.reset}}
    reset := {{timer.reset.value}},{{#endif}}{{#if timer.enable || timer.reset}}
    {{#endif}}PPS := {{timer.PPS.value}});
{{#endfor timer}}{{#if loop_end}}

{{loop_end}}{{#endif}}
END_FUNCTION
`;

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const timer = {
            node,
            comment: new STRING(node.get('comment') ?? '')
        };
        const DB = node.get('DB');
        if (!DB) throw new SyntaxError("timer转换必须有DB块!");
        const comment = timer.comment.value;
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(
            symbol => timer.DB = symbol
        );

        const infos = {
            document,
            force: { type: 'BOOL' },
            s7_expr_desc: `timer ${comment}`,
        };
        make_s7_expression(node.get('enable'), infos).then(symbol => timer.enable = symbol);
        make_s7_expression(node.get('reset'), infos).then(symbol => timer.reset = symbol);
        make_s7_expression(node.get('PPS') ?? "Clock_1Hz", infos).then(symbol => timer.PPS = symbol);
        return timer;
    });
}

export function gen(timer_list) {
    const rules = [];
    timer_list.forEach(({ document, includes, loop_begin, loop_end, list }) => {
        const { CPU, gcl } = document;
        const { output_dir, platform } = CPU;
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
                platform,
                includes,
                loop_begin,
                loop_end,
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
    const filename = item.document.CPU.platform == 'portal' ? `${NAME}(portal).scl` : `${NAME}.scl`;
    const src = posix.join(context.module_path, NAME, filename);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst }];
}

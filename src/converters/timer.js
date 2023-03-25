import { make_prop_symbolic } from '../symbols.js';
import { STRING } from '../value.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7'];
export const NAME = `Timer_Proc`;
export const LOOP_NAME = 'Timer_Loop';

export function is_feature(feature) {
    return feature.toLowerCase() === 'timer';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{document.gcl.file}}
// 摘要: {{document.gcl.MD5}}
{{includes}}

// 主循环调用
FUNCTION "{{LOOP_NAME}}" : VOID
{{#for timer in list}}
// {{timer.comment}}
"{{NAME}}".{{timer.DB.value}}({{#if timer.enable}}
    enable := {{timer.enable.value}},{{#endif}}{{#if timer.reset}}
    reset := {{timer.reset.value}},{{#endif}}{{#if timer.enable || timer.reset}}
    {{#endif}}PPS := {{timer.PPS.value}});
{{#endfor timer}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols({ CPU, list }) {
    const document = CPU.timer;
    list.forEach(timer => {
        if (!timer.DB) throw new SyntaxError("timer转换必须有DB块!");
        timer.comment = new STRING(timer.comment ?? '');
        const comment = timer.comment ? `${timer.comment} DB` : '';
        make_prop_symbolic(timer, 'DB', document, { force: { type: NAME }, default: { comment } });
        timer.PPS ??= '"Pulse_1Hz"';
        const options = { force: { type: 'BOOL' } };
        make_prop_symbolic(timer, 'enable', document, options);
        make_prop_symbolic(timer, 'reset', document, options);
        make_prop_symbolic(timer, 'PPS', document, options);
    });
}

export function gen(timer_list) {
    const rules = [];
    timer_list.forEach(({ CPU, includes, loop_additional_code, list }) => {
        const { output_dir } = CPU;
        const document = CPU.timer;
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
                includes,
                loop_additional_code,
                NAME,
                LOOP_NAME,
                list,
                document,
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

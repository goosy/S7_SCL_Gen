import { make_prop_symbolic } from '../symbols.js';
import { context } from '../util.js';
import { posix } from 'path';

export const platforms = ['step7'];
export const NAME = `Timer_Proc`;
export const LOOP_NAME = 'Timer_Loop';

export function is_type(type) {
    return type.toLowerCase() === 'timer';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
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
        const comment = timer.comment ? `${timer.comment} DB` : '';
        make_prop_symbolic(timer, 'DB', CPU, { document, force: { type: NAME }, default: { comment } });
        timer.PPS ??= '"Pulse_1Hz"';
        const options = { document, force: { type: 'BOOL' } };
        make_prop_symbolic(timer, 'enable', CPU, options);
        make_prop_symbolic(timer, 'reset', CPU, options);
        make_prop_symbolic(timer, 'PPS', CPU, options);
    });
}

export function gen(timer_list) {
    const rules = [];
    timer_list.forEach(({ CPU, includes, loop_additional_code, list }) => {
        const { name, output_dir } = CPU;
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
                name,
                includes,
                loop_additional_code,
                NAME,
                LOOP_NAME,
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

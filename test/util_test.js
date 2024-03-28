import { strictEqual } from "node:assert/strict";
import { posix } from "node:path";
import { fileURLToPath } from 'node:url';
import { get_rules } from "../src/rules.js";
import { get_template, pad_left, pad_right } from '../src/util.js';

const curr_dir = posix.dirname(fileURLToPath(import.meta.url));
process.chdir(curr_dir);

const test_template = `# 联校调试记录

工程名称： {{title}}
测试内容： 通道联调

[{{(options.output_file+'').replace('.md','')}}]
| 回路 | 仪表位号 | 测量范围 | 实测值 0% | 实测值 50% | 实测值 100% | 报警值 | 调试结果 |
| --- | --- | :---: | --- | --- | --- | --- | --- |
{{for no, AI in list}}{{if AI.DB}}_
{{diff = (no % 20) / 1000.0 * (AI.$span - AI.$zero)}}_
{{ has_span = (AI.$zero !== undefined) && (AI.$span !== undefined)}}_
| | {{AI.DB.name}} |  {{if has_span}}_
{{AI.$zero}} - {{AI.$span}}{{endif}} | {{if has_span}}_
{{ (AI.$zero.value + diff).toFixed(3)}}{{endif}} | {{if has_span}}_
{{ (AI.$zero.value / 2 + AI.$span.value / 2 + diff).toFixed(3)}}{{endif}} | {{if has_span}}_
{{ (AI.$span.value - diff).toFixed(3)}}{{endif}} | {{if AI.$AH_limit !== undefined}}_
AH: {{AI.$AH_limit}} {{endif}}{{if AI.$WH_limit !== undefined}}_
WH: {{AI.$WH_limit}} {{endif}}{{if AI.$WL_limit !== undefined}}_
WL: {{AI.$WL_limit}} {{endif}}{{if AI.$AL_limit !== undefined}}_
AL: {{AI.$AL_limit}} {{endif}} | 合格 |
{{endif // AI.DB}}{{endfor}}
调试单位: __________________________ 专业工程师: ________ 质量检查员: ________ 施工班组长: ________
日期: ________ 年 ____ 月 ____ 日
`

describe('util test', () => {
    it('pad_left test', () => {
        strictEqual(pad_left('abcdef', 20), '              abcdef');
        strictEqual(pad_left('abcdef', 4), 'cdef');
        strictEqual(pad_left('abcdef', 15, '*'), '*********abcdef');
    })
    it('pad_right test', () => {
        strictEqual(pad_right('abcdef', 20), 'abcdef              ');
        strictEqual(pad_right('abcdef', 4), 'abcd');
        strictEqual(pad_right('abcdef', 15, '*'), 'abcdef*********');
    })
    it('get_template test', async () => {
        strictEqual(await get_template('template.md'), test_template);
    })
    it('get_rules test', async () => {
        const tasks = await get_rules('yaml/rules.yaml');
        strictEqual(tasks.length, 2);
        const task = tasks[0];
        strictEqual(task.path, '.');
        // 对每个 task 中 rules 的路径的测试，必须当前目录先进入 task.path
        const rules = task.rules;
        strictEqual(rules.length, 3);
        strictEqual(rules[1].pattern.type, 'convert');
        strictEqual(rules[1].modifications.template, test_template);
        strictEqual(rules[2].modifications.output_dir, 'target');
    })
});

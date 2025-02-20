import { strictEqual } from "node:assert/strict";
import { suite, test } from 'node:test';
import { get_template, pad_left, pad_right } from '../src/util.js';

const test_template = `# 联校调试记录

工程名称： {{title[cpu_name]}}
测试内容： 通道联调

[{{title[cpu_name]}}表格]
| 回路 | 仪表位号 | 测量范围 | 实测值 0% | 实测值 50% | 实测值 100% | 报警值 | 调试结果 |
| --- | --- | :---: | --- | --- | --- | --- | --- |
{{for no, AI in list}}{{if AI.DB}}_
{{diff = (no % 20) / 1000.0 * (AI.$span - AI.$zero)}}_
{{ has_span = (AI.$zero !== undefined) && (AI.$span !== undefined)}}_
| | {{AI.DB.name}} | {{if has_span}}{{AI.$zero}} - {{AI.$span}}{{endif}}_
 | {{if has_span}}{{ (AI.$zero.value + diff).toFixed(3) }}{{endif}}_
 | {{if has_span}}{{ (AI.$zero.value / 2 + AI.$span.value / 2 + diff).toFixed(3) }}{{endif}}_
 | {{if has_span}}{{ (AI.$span.value - diff).toFixed(3) }}{{endif}}_
 | {{if AI.$AH_limit !== undefined}}AH: {{AI.$AH_limit}} {{endif}}_
{{if AI.$WH_limit !== undefined}}WH: {{AI.$WH_limit}} {{endif}}_
{{if AI.$WL_limit !== undefined}}WL: {{AI.$WL_limit}} {{endif}}_
{{if AI.$AL_limit !== undefined}}AL: {{AI.$AL_limit}} {{endif}}_
| 合格 |
{{endif // AI.DB}}{{endfor}}
调试单位: __________________________ 专业工程师: ________ 质量检查员: ________ 施工班组长: ________
日期: ________ 年 ____ 月 ____ 日
`;

suite('util test', () => {
    test('pad_left test', () => {
        strictEqual(pad_left('abcdef', 20), '              abcdef');
        strictEqual(pad_left('abcdef', 4), 'cdef');
        strictEqual(pad_left('abcdef', 15, '*'), '*********abcdef');
    });
    test('pad_right test', () => {
        strictEqual(pad_right('abcdef', 20), 'abcdef              ');
        strictEqual(pad_right('abcdef', 4), 'abcd');
        strictEqual(pad_right('abcdef', 15, '*'), 'abcdef*********');
    });
    test('get_template test', async () => {
        strictEqual(await get_template('test/template.md'), test_template);
    });
});

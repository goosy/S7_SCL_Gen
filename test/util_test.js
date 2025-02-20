import { strictEqual, deepStrictEqual } from "node:assert/strict";
import { suite, test } from 'node:test';
import { compare, get_object_prop, multi_sort, get_template, pad_left, pad_right } from '../src/util.js';

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
    test('compare test', () => {
        // Basic type comparison
        strictEqual(compare(1, 2), -1);        // Ascending order
        strictEqual(compare(2, 1), 1);         // Ascending order
        strictEqual(compare(1, 1), 0);         // Equal

        // Descending order test
        strictEqual(compare(1, 2, true), 1);   // Descending order
        strictEqual(compare(2, 1, true), -1);  // Descending order
        strictEqual(compare(1, 1, true), 0);   // Equal

        // String comparison
        strictEqual(compare('a', 'b'), -1);    // Ascending order
        strictEqual(compare('b', 'a'), 1);     // Ascending order
        strictEqual(compare('a', 'a'), 0);     // Equal

        // Different type comparison
        strictEqual(compare(1, '1'), 0);       // Different type returns 0
        strictEqual(compare(null, undefined), 0); // Different type returns 0
    });
    test('get_object_prop test', () => {
        const obj = {
            a: {
                b: {
                    c: 'value'
                },
                d: null
            },
            e: undefined
        };
        // Normal path
        strictEqual(get_object_prop(obj, 'a.b.c'), 'value');
        // Single-layer attribute
        strictEqual(get_object_prop(obj, 'e'), undefined);
        // Non-existent path
        strictEqual(get_object_prop(obj, 'a.b.x'), undefined);
        // Empty object
        strictEqual(get_object_prop({}, 'a.b'), undefined);
        // Null value path
        strictEqual(get_object_prop(obj, 'a.d.x'), undefined);
    });

    test('multi_sort test', () => {
        const list = [
            { name: 'Alice', age: 30, score: { math: 90, english: 85 } },
            { name: 'Bob', age: 25, score: { math: 85, english: 90 } },
            { name: 'Alice', age: 25, score: { math: 95, english: 80 } }
        ];

        // Single condition sorting - simple property
        let testList = [...list];
        multi_sort(testList, ['age']);
        deepStrictEqual(testList, [
            { name: 'Bob', age: 25, score: { math: 85, english: 90 } },
            { name: 'Alice', age: 25, score: { math: 95, english: 80 } },
            { name: 'Alice', age: 30, score: { math: 90, english: 85 } }
        ]);
        // Multiple condition sorting - including nested properties
        multi_sort(testList, ['name', '@score.math']);
        deepStrictEqual(testList, [
            { name: 'Alice', age: 25, score: { math: 95, english: 80 } },
            { name: 'Alice', age: 30, score: { math: 90, english: 85 } },
            { name: 'Bob', age: 25, score: { math: 85, english: 90 } }
        ]);
        // Complex sorting - multiple conditions with mixed order
        testList = [...list];
        multi_sort(testList, ['name', '@age', 'score.english']);
        deepStrictEqual(testList, [
            { name: 'Alice', age: 30, score: { math: 90, english: 85 } },
            { name: 'Alice', age: 25, score: { math: 95, english: 80 } },
            { name: 'Bob', age: 25, score: { math: 85, english: 90 } }
        ]);
        // Empty array test
        const emptyList = [];
        multi_sort(emptyList, ['name']);
        deepStrictEqual(emptyList, []);
        // Non-array input test
        const notArray = {};
        multi_sort(notArray, ['name']);
        deepStrictEqual(notArray, {});
    });

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

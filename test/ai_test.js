import { match, ok, rejects, strictEqual } from "node:assert/strict";
import { suite, test } from 'node:test';
import { convert as gc } from 'gooplate';
import { gen_data } from '../src/gen_data.js';
import { context } from '../src/util.js';

context.silent = true;

/**
 * Build a CPU document plus an AI document with one item per entry.
 * @param {string[]} items flow-mapping keys of each item, e.g. '$overflow_SP: 105%'
 */
function make_yaml(items) {
    const list = items.map((extra, i) => {
        const keys = [`DB: [ai_${i}, DB${11 + i}]`, `input: [TIT${i}, PIW${512 + 2 * i}]`, `comment: TIT${i}`];
        if (extra) keys.push(extra);
        return `- {${keys.join(', ')}}`;
    });
    return `---
name: T-CPU
platform: step7
---
name: T-AI
list:
${list.join('\n')}
`;
}

async function render(items) {
    const list = await gen_data({ yaml: make_yaml(items) });
    const ai = list.find(item => item.feature === 'AI' && item.type === 'convert');
    ok(ai, 'AI convert item is missing');
    return gc(ai.tags, ai.template);
}

suite('AI overflow and underflow setpoints', () => {
    test('raw values are written as is', async () => {
        match(
            await render(['$overflow_SP: 28500, $underflow_SP: -800']),
            /\n {4}overflow_SP := 28500;\n {4}underflow_SP := -800;\n/,
        );
    });

    test('percentages are converted against the default raw range', async () => {
        match(
            await render(['$overflow_SP: 105%, $underflow_SP: \'-5 %\'']),
            /\n {4}overflow_SP := 29030;\n {4}underflow_SP := -1382;\n/,
        );
        match(
            await render(['$overflow_SP: 90%, $underflow_SP: 10.5%']),
            /\n {4}overflow_SP := 24883;\n {4}underflow_SP := 2903;\n/,
        );
    });

    test('percentages follow $zero_raw and $span_raw', async () => {
        match(
            await render(['$zero_raw: 5530, $overflow_SP: 105%, $underflow_SP: -5%']),
            /\n {4}zero_raw := 5530;\n {4}span_raw := 27648;\n {4}overflow_SP := 28754;\n {4}underflow_SP := 4424;\n/,
        );
        match(
            await render(['$zero_raw: 0, $span_raw: 10000, $overflow_SP: 110%, $underflow_SP: 0%']),
            /\n {4}overflow_SP := 11000;\n {4}underflow_SP := 0;\n/,
        );
        // Reverse raw range: 0% is zero_raw
        match(
            await render(['$zero_raw: 27648, $span_raw: 0, $overflow_SP: -5%, $underflow_SP: 105%']),
            /\n {4}overflow_SP := 29030;\n {4}underflow_SP := -1382;\n/,
        );
    });

    test('defaults are written when the keys are omitted', async () => {
        match(
            await render(['']),
            /\n {4}zero_raw := 0;\n {4}span_raw := 27648;\n {4}overflow_SP := 28000;\n {4}underflow_SP := -500;\n {4}zero := 0\.0;\n {4}span := 100\.0;\n/,
        );
    });
});

suite('AI checks', () => {
    test('setpoints must be integers or percentage strings', async (t) => {
        // Pass-1 errors are caught and logged by gen_data, which then stops
        const log = t.mock.method(console, 'log', () => { });
        const items = ['$overflow_SP: 28000.5', '$overflow_SP: abc', '$underflow_SP: \'-5\'', '$overflow_SP: 5%%'];
        for (const item of items) {
            await rejects(render([item]), /AI convert item is missing/, item);
        }
        strictEqual(log.mock.callCount(), items.length);
        for (const call of log.mock.calls) {
            const error = call.arguments[0];
            strictEqual(error.name, 'SyntaxError');
            match(error.message, /AI \(TIT\d\) 的 \$(over|under)flow_SP .* 必须是整数原始值或百分比字符串/);
        }
    });

    test('a percentage beyond INT is an error', async (t) => {
        const log = t.mock.method(console, 'log', () => { });
        await rejects(render(['$overflow_SP: 200%']), /AI convert item is missing/);
        strictEqual(log.mock.callCount(), 1);
        match(log.mock.calls[0].arguments[0].message, /超出 INT 范围/);
    });

    test('setpoints must not reach the non-measurement markers', async () => {
        for (const item of [
            '$overflow_SP: 32767',
            '$underflow_SP: -32768',
            '$span_raw: 32767, $overflow_SP: 100%',
            '$span_raw: -32768, $overflow_SP: -1%, $underflow_SP: 100%',
        ]) {
            await rejects(
                render([item]),
                { name: 'SyntaxError', message: /原始值 .* 超出范围 -32767 ~ 32766/ },
                item,
            );
        }
        await render(['$overflow_SP: 32766, $underflow_SP: -32767']); // bounds are allowed
    });

    test('overflow must be above underflow, defaults included', async () => {
        for (const item of [
            '$overflow_SP: 10000, $underflow_SP: 20000',
            '$overflow_SP: 50%, $underflow_SP: 50%',
            '$underflow_SP: 28000', // equal to the default overflow
            '$overflow_SP: -500', // equal to the default underflow
        ]) {
            await rejects(
                render([item]),
                { name: 'SyntaxError', message: /上溢出值 .* 必须大于下溢出值/ },
                item,
            );
        }
    });

    test('zero_raw and span_raw must differ, defaults included', async () => {
        for (const item of ['$zero_raw: 5000, $span_raw: 5000', '$span_raw: 0', '$zero_raw: 27648']) {
            await rejects(
                render([item]),
                { name: 'SyntaxError', message: /zero_raw 与 span_raw 不能相等/ },
                item,
            );
        }
    });

    test('an item without DB and input is not parsed', async () => {
        const yaml = `---
name: T-CPU
---
name: T-AI
list:
- {comment: placeholder, $overflow_SP: 10, $underflow_SP: abc}
- DB: [ai_1, DB12]
`;
        const list = await gen_data({ yaml });
        ok(list.find(item => item.feature === 'AI' && item.type === 'convert'));
    });
});

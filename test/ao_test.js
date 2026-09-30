import { doesNotMatch, match, ok, rejects, strictEqual } from "node:assert/strict";
import { suite, test } from 'node:test';
import { convert as gc } from 'gooplate';
import { gen_data } from '../src/gen_data.js';
import { context } from '../src/util.js';

context.silent = true;

/**
 * Build a CPU document plus an AO document with one item per entry.
 * @param {string} platform platform of the CPU document
 * @param {string[]} items flow-mapping keys of each item, e.g. 'output: [Y1, PQW512]'
 */
function make_yaml(platform, items) {
    const list = items.map((extra, i) => {
        const keys = [`DB: [ao_${i}, DB${11 + i}]`];
        if (extra) keys.push(extra);
        return `- {${keys.join(', ')}}`;
    });
    return `---
name: T-CPU
platform: ${platform}
---
name: T-AO
list:
${list.join('\n')}
`;
}

async function render(items, platform = 'step7') {
    const list = await gen_data({ yaml: make_yaml(platform, items) });
    const ao = list.find(item => item.feature === 'AO' && item.type === 'convert');
    ok(ao, 'AO convert item is missing');
    return gc(ao.tags, ao.template);
}

suite('AO loop', () => {
    test('PV, FB call and output in order', async () => {
        const item = 'PV: \'"PID".LMN\', output: [Y0, PQW512]';
        match(
            await render([item]),
            /\n"ao_0"\.PV := "PID"\.LMN;\n"AO_Proc"\."ao_0"\(\);\n"Y0" := "ao_0"\.AO;\n/,
        );
        match(
            await render([item], 'portal'),
            /\n"ao_0"\.PV := "PID"\.LMN;\n"ao_0"\(\);\n"Y0" := "ao_0"\.AO;\n/,
        );
    });

    test('extra_code goes between the PV assignment and the FB call', async () => {
        const yaml = `---
name: T-CPU
---
name: T-AO
list:
- DB: [ao_0, DB11]
  PV: '"SP".value'
  extra_code: |-
    IF NOT "P1".remote THEN
      "ao_0".PV := "SIT".PV;
    END_IF;
`;
        const list = await gen_data({ yaml });
        const ao = list.find(item => item.feature === 'AO' && item.type === 'convert');
        match(
            gc(ao.tags, ao.template),
            /\n"ao_0"\.PV := "SP"\.value;\nIF NOT "P1"\.remote THEN\n {2}"ao_0"\.PV := "SIT"\.PV;\nEND_IF;\n"AO_Proc"\."ao_0"\(\);\n/,
        );
    });

    test('no PV assignment or output without PV or output', async () => {
        const scl = await render(['']);
        doesNotMatch(scl, /"ao_0"\.PV :=/);
        doesNotMatch(scl, /"ao_0"\.AO;/);
        match(scl, /"AO_Proc"\."ao_0"\(\);/);
    });

    test('an item without DB is skipped', async () => {
        const yaml = `---
name: T-CPU
---
name: T-AO
list:
- comment: placeholder
- DB: [ao_1, DB12]
`;
        const list = await gen_data({ yaml });
        const ao = list.find(item => item.feature === 'AO' && item.type === 'convert');
        const scl = gc(ao.tags, ao.template);
        doesNotMatch(scl, /placeholder/);
        match(scl, /"AO_Proc"\."ao_1"\(\);/);
    });
});

suite('AO instance DB', () => {
    test('$PV defaults to $zero for unipolar modes', async () => {
        match(await render(['$zero: 4.0, $span: 20.0']), /BEGIN\n {4}PV := 4\.0;\n {4}zero := 4\.0;\n {4}span := 20\.0;\nEND_DATA_BLOCK/);
        match(await render(['$mode: 0-10V, $zero: 20.0, $span: 50.0']), /BEGIN\n {4}PV := 20\.0;\n/);
        match(await render(['$zero: 4.0, $span: 20.0, $PV: 8.0']), /BEGIN\n {4}PV := 8\.0;\n/);
    });

    test('$PV defaults to the range midpoint for bipolar modes', async () => {
        match(await render(['$mode: +-10V, $zero: 0.0, $span: 100.0']), /BEGIN\n {4}PV := 50\.0;\n {4}mode := 4;\n/);
        match(await render(['$mode: +-20mA, $zero: -20.0, $span: 100.0']), /BEGIN\n {4}PV := 40\.0;\n/);
        match(await render(['$mode: +-10V']), /BEGIN\n {4}PV := 50\.0;\n/); // FB defaults 0.0 ~ 100.0
    });

    test('a default $PV equal to the FB default 0.0 is not written', async () => {
        doesNotMatch(await render(['$mode: +-10V, $zero: -100.0, $span: 100.0']), /PV :=/);
        doesNotMatch(await render(['$mode: 0-20mA, $span: 50.0']), /PV :=/);
        doesNotMatch(await render(['']), /PV :=/);
        match(await render(['$PV: 0.0']), /BEGIN\n {4}PV := 0\.0;\n/); // explicit is always written
    });

    test('clamp limits are written as raw values', async () => {
        match(
            await render(['$overflow_SP: 29500, $underflow_SP: -500']),
            /BEGIN\n {4}overflow_SP := 29500;\n {4}underflow_SP := -500;\nEND_DATA_BLOCK/,
        );
    });

    test('percentage clamp limits are converted against 27648', async () => {
        match(
            await render(['$overflow_SP: 105%, $underflow_SP: \'-5 %\'']),
            /BEGIN\n {4}overflow_SP := 29030;\n {4}underflow_SP := -1382;\nEND_DATA_BLOCK/,
        );
        match(
            await render(['$overflow_SP: 90%, $underflow_SP: 10.5%']),
            /BEGIN\n {4}overflow_SP := 24883;\n {4}underflow_SP := 2903;\nEND_DATA_BLOCK/,
        );
    });

    test('$mode is written as an integer, from a number or a name', async () => {
        match(await render(['$mode: 2']), /BEGIN\n {4}mode := 2;\nEND_DATA_BLOCK/);
        match(await render(['$mode: 0-10V']), /BEGIN\n {4}mode := 2;\nEND_DATA_BLOCK/);
        match(await render(['$mode: +-10v']), /\n {4}mode := 4;\nEND_DATA_BLOCK/); // preceded by the default PV
        match(await render(["$mode: ' 4-20MA '"]), /BEGIN\n {4}mode := 0;\nEND_DATA_BLOCK/);
    });

    test('an omitted $underflow_SP is not written for any mode', async () => {
        for (const mode of ['4-20mA', '0-10V', '+-10V']) {
            doesNotMatch(await render([`$mode: ${mode}`]), /underflow_SP :=/, mode);
        }
    });

    test('nothing is written when the $ keys are omitted', async () => {
        match(await render(['']), /BEGIN\nEND_DATA_BLOCK/);
    });

    test('portal DB is not optimized', async () => {
        match(await render([''], 'portal'), /DATA_BLOCK "ao_0"\n\{ S7_Optimized_Access := 'FALSE' \}\n/);
    });
});

suite('AO checks', () => {
    test('output accepts a symbol reference or a single variable', async () => {
        const scl = await render(['output: [Y0, PQW512]', 'output: Y0', 'output: \'"DB9".raw\'']);
        match(scl, /"Y0" := "ao_0"\.AO;/);
        match(scl, /"Y0" := "ao_1"\.AO;/);
        match(scl, /"DB9"\.raw := "ao_2"\.AO;/);
    });

    test('output must not be a constant or an expression', async () => {
        for (const output of ['TRUE', '1', '\'"a" + "b"\'']) {
            await rejects(
                render([`output: ${output}`]),
                { name: 'SyntaxError', message: /output .* 必须是可赋值的 WORD 变量/ },
                `output: ${output}`,
            );
        }
    });

    test('zero and span must differ, FB defaults included', async () => {
        for (const item of ['$zero: 5.0, $span: 5.0', '$span: 0.0', '$zero: 100.0']) {
            await rejects(
                render([item]),
                { name: 'SyntaxError', message: /zero 与 span 不能相等/ },
                item,
            );
        }
    });

    test('clamp limits must be integers or percentage strings', async (t) => {
        // Pass-1 errors are caught and logged by gen_data, which then stops
        const log = t.mock.method(console, 'log', () => { });
        const items = ['$overflow_SP: 29000.5', '$overflow_SP: abc', '$underflow_SP: \'-5\'', '$overflow_SP: 5%%'];
        for (const item of items) {
            await rejects(render([item]), /AO convert item is missing/, item);
        }
        strictEqual(log.mock.callCount(), items.length);
        for (const call of log.mock.calls) {
            const error = call.arguments[0];
            strictEqual(error.name, 'SyntaxError');
            match(error.message, /必须是整数原始值或百分比字符串/);
        }
    });

    test('$mode must be one of the output modes', async (t) => {
        const log = t.mock.method(console, 'log', () => { });
        const items = ['$mode: 6', '$mode: -1', '$mode: 1.5', '$mode: 4-20', '$mode: true'];
        for (const item of items) {
            await rejects(render([item]), /AO convert item is missing/, item);
        }
        strictEqual(log.mock.callCount(), items.length);
        for (const call of log.mock.calls) {
            const error = call.arguments[0];
            strictEqual(error.name, 'SyntaxError');
            match(error.message, /必须是以下输出模式之一/);
        }
    });

    test('the hardware low limit depends on the mode', async () => {
        for (const item of ['$mode: 0-10V, $underflow_SP: -1', '$mode: 0-20mA, $underflow_SP: -500', '$mode: +-10V, $underflow_SP: -32513']) {
            await rejects(
                render([item]),
                { name: 'SyntaxError', message: /原始值 .* 超出 .* 的输出范围/ },
                item,
            );
        }
        await render(['$mode: 0-10V, $underflow_SP: 0']);
        await render(['$mode: +-20mA, $underflow_SP: -32512, $overflow_SP: -105%']);
    });

    test('clamp limits must lie within the output range', async () => {
        for (const item of ['$overflow_SP: 32512', '$overflow_SP: 118%', '$underflow_SP: -6913', '$underflow_SP: -26%']) {
            await rejects(
                render([item]),
                { name: 'SyntaxError', message: /原始值 .* 超出 4-20mA 的输出范围 -6912 ~ 32511/ },
                item,
            );
        }
        await render(['$overflow_SP: 32511, $underflow_SP: -6912']); // bounds are allowed
    });

    test('clamp high limit must be above the low limit, FB defaults included', async () => {
        for (const item of [
            '$overflow_SP: 10000, $underflow_SP: 20000',
            '$overflow_SP: 50%, $underflow_SP: 50%',
            '$underflow_SP: 28000', // equal to the default high limit
            '$overflow_SP: -500', // equal to the default low limit
        ]) {
            await rejects(
                render([item]),
                { name: 'SyntaxError', message: /限幅上限 .* 必须大于下限/ },
                item,
            );
        }
    });

    test('the default low limit for the high-low check depends on the mode', async () => {
        for (const item of ['$mode: 0-10V, $overflow_SP: 0', '$mode: +-10V, $overflow_SP: -28000']) {
            await rejects(
                render([item]),
                { name: 'SyntaxError', message: /限幅上限 .* 必须大于下限/ },
                item,
            );
        }
        await render(['$mode: 0-10V, $overflow_SP: 1']);
        await render(['$mode: +-10V, $overflow_SP: -27999']);
    });

    test('a bipolar $PV warning uses the bipolar zero raw value', async (t) => {
        const error = t.mock.method(console, 'error', () => { });
        // zero -10.0 maps to -27648, default low -28000 is about -10.127
        await render(['$mode: +-10V, $zero: -10.0, $span: 10.0, $PV: -10.1']);
        await render(['$mode: +-10V, $zero: -10.0, $span: 10.0, $PV: 0.0']);
        strictEqual(error.mock.callCount(), 0);
        await render(['$mode: +-10V, $zero: -10.0, $span: 10.0, $PV: -10.2']);
        strictEqual(error.mock.callCount(), 1);
        match(error.mock.calls[0].arguments[0], /\$PV 超出限幅范围/);
    });

    test('an explicit $PV that would be clamped warns', async (t) => {
        const error = t.mock.method(console, 'error', () => { });
        await render(['$zero: 100.0, $span: 0.0, $PV: 50.0']); // reverse range, inside
        await render(['$zero: 0.0, $span: 50.0, $PV: 50.5']); // below the default high limit 28000 (50.6)
        await render(['$zero: -10.0']); // $PV defaults to $zero, never warns
        strictEqual(error.mock.callCount(), 0);
        await render(['$zero: 0.0, $span: 50.0, $PV: 60.0']);
        await render(['$zero: 0.0, $span: 50.0, $overflow_SP: 90%, $PV: 48.0']);
        strictEqual(error.mock.callCount(), 2);
        match(error.mock.calls[0].arguments[0], /\$PV 超出限幅范围/);
    });
});

import { doesNotMatch, match, ok, rejects } from "node:assert/strict";
import { suite, test } from 'node:test';
import { convert as gc } from 'gooplate';
import { gen_data } from '../src/gen_data.js';
import { context } from '../src/util.js';

context.silent = true;

/**
 * Build a CPU document plus an RP document with one item per entry.
 * @param {string} platform platform of the CPU document
 * @param {string[]} items extra flow-mapping keys of each item, e.g. 'output: [Y1, Q0.0]'
 */
function make_yaml(platform, items) {
    const list = items.map((extra, i) => {
        const keys = [`DB: [rp_${i}, DB${11 + i}]`, 'type: onDelay', `input: [X${i}, I0.${i}]`];
        if (extra) keys.push(extra);
        return `- {${keys.join(', ')}}`;
    });
    return `---
name: T-CPU
platform: ${platform}
---
name: T-RP
list:
${list.join('\n')}
`;
}

async function render(items, platform = 'step7') {
    const list = await gen_data({ yaml: make_yaml(platform, items) });
    const rp = list.find(item => item.feature === 'RP' && item.type === 'convert');
    ok(rp, 'RP convert item is missing');
    return gc(rp.tags, rp.template);
}

suite('RP output', () => {
    test('output is assigned from the instance Q after the call', async () => {
        match(
            await render(['output: [Y0, Q0.0]']),
            /"TON"\."rp_0"\(IN := "X0"\); \/\/ [^\n]*\n"Y0" := "rp_0"\.Q;\n/,
        );
        match(
            await render(['output: [Y0, Q0.0]'], 'portal'),
            /\n"rp_0"\(IN := "X0"\); \/\/ [^\n]*\n"Y0" := "rp_0"\.Q;\n/,
        );
    });

    test('no assignment without output', async () => {
        const scl = await render(['', 'output: [Y1, Q0.1]']);
        doesNotMatch(scl, /"rp_0"\.Q/);
        match(scl, /"Y1" := "rp_1"\.Q;/);
    });

    test('output accepts a symbol reference or a single variable', async () => {
        const scl = await render(['output: X1', 'output: \'"DB9".flag\'']);
        match(scl, /"X1" := "rp_0"\.Q;/);
        match(scl, /"DB9"\.flag := "rp_1"\.Q;/);
    });

    test('output must not be a constant or an expression', async () => {
        for (const output of ['TRUE', 'false', '1', '\'"a" AND "b"\'', '\'NOT "a"\'']) {
            await rejects(
                render([`output: ${output}`]),
                { name: 'SyntaxError', message: /output .* 必须是可赋值的 BOOL 变量/ },
                `output: ${output}`,
            );
        }
    });
});

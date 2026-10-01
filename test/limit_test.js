import { doesNotMatch, match, ok, rejects, strictEqual } from "node:assert/strict";
import { suite, test } from 'node:test';
import { convert as gc } from 'gooplate';
import { gen_data } from '../src/gen_data.js';
import { context } from '../src/util.js';

context.silent = true;

/**
 * Build a CPU document plus a limit document with one item per entry.
 * @param {string[]} items flow-mapping keys of each item, e.g. '$HH_limit: 10'
 * @param {object} [options]
 * @param {string} [options.platform='step7']
 * @param {string} [options.feature='limit'] feature of the document
 */
function make_yaml(items, { platform = 'step7', feature = 'limit' } = {}) {
    const list = items.map((extra, i) => {
        const keys = [`DB: [lc_${i}, DB${11 + i}]`, `input: '"tank".PV${i}'`, `comment: LIT${i}`];
        if (extra) keys.push(extra);
        return `- {${keys.join(', ')}}`;
    });
    return `---
name: T-CPU
platform: ${platform}
---
CPU: T
feature: ${feature}
list:
${list.join('\n')}
`;
}

async function convert_items(items, options) {
    return gen_data({ yaml: make_yaml(items, options) });
}

async function render(items, options) {
    const list = await convert_items(items, options);
    const lc = list.find(item => item.feature === 'limit' && item.type === 'convert');
    ok(lc, 'limit convert item is missing');
    return gc(lc.tags, lc.template);
}

suite('limit feature names', () => {
    test('limit, limitcheck and LC are accepted case-insensitively', async () => {
        for (const feature of ['limit', 'Limit', 'limitcheck', 'LimitCheck', 'LC', 'lc']) {
            const list = await convert_items([''], { feature });
            ok(list.find(item => item.feature === 'limit' && item.type === 'convert'), feature);
        }
    });

    test('the former alarm names are no longer accepted', async (t) => {
        // An unsupported feature is reported and skipped
        const error = t.mock.method(console, 'error', () => { });
        for (const feature of ['alarm', 'pv', 'pv_alarm', 'pvalarm']) {
            const list = await convert_items([''], { feature });
            ok(!list.some(item => item.feature === 'limit'), feature);
        }
        strictEqual(error.mock.callCount(), 4);
    });
});

suite('limit output', () => {
    test('the instance DB is typed Limit_Proc', async () => {
        const scl = await render(['$HH_limit: 10, $LL_limit: 1']);
        match(scl, /\/\/ Limit_Proc 背景块：LIT0\nDATA_BLOCK "lc_0"\nAUTHOR : Goosy\nFAMILY : GooLib\n"Limit_Proc"\nBEGIN\n/);
        match(
            scl,
            /\n {4}enable_HH := TRUE;\n {4}enable_H := FALSE;\n {4}enable_L := FALSE;\n {4}enable_LL := TRUE;\n {4}zero := 0\.0;\n {4}span := 100\.0;\n {4}HH_limit := 10\.0;\n {4}LL_limit := 1\.0;\nEND_DATA_BLOCK\n/,
        );
    });

    test('step7 calls the FB through Limit_Loop', async () => {
        const scl = await render(['invalid: \'"tank".bad\', enable_HH: \'"pump".run\'']);
        match(scl, /\nFUNCTION "Limit_Loop" : VOID\n/);
        match(scl, /\n"Limit_Proc"\."lc_0"\(PV := "tank"\.PV0, invalid := "tank"\.bad, enable_HH := "pump"\.run\); \/\/ LIT0\n/);
    });

    test('portal calls the instance DB without the FB name', async () => {
        const scl = await render([''], { platform: 'portal' });
        match(scl, /\nDATA_BLOCK "lc_0"\n\{ S7_Optimized_Access := 'FALSE' \}\n/);
        match(scl, /\n"lc_0"\(PV := "tank"\.PV0\); \/\/ LIT0\n/);
        doesNotMatch(scl, /"Limit_Proc"\./);
    });

    test('the Limit_Proc library is copied', async () => {
        for (const platform of ['step7', 'portal', 'pcs7']) {
            const list = await convert_items([''], { platform });
            const copy = list.find(item => item.feature === 'limit' && item.type === 'copy');
            ok(copy, platform);
            strictEqual(copy.source, `Limit_Proc/Limit_Proc(${platform}).scl`);
            strictEqual(copy.distance, 'T/Limit_Proc.scl');
        }
    });

    test('built-in symbols are Limit_Proc FB519 and Limit_Loop FC519', async () => {
        const list = await convert_items(['']);
        const symbols = list.find(item => item.feature === 'symbol').tags.list;
        const find = name => symbols.find(symbol => symbol.name === name);
        match(find('Limit_Proc')?.address, /^FB\s+519\s*$/);
        match(find('Limit_Loop')?.address, /^FC\s+519\s*$/);
    });
});

suite('limit checks', () => {
    test('limits must be ordered', async (t) => {
        // Pass-1 errors are caught and logged by gen_data, which then stops
        const log = t.mock.method(console, 'log', () => { });
        const items = ['$HH_limit: 1, $H_limit: 2', '$L_limit: 5, $H_limit: 4', '$LL_limit: 3, $L_limit: 2'];
        for (const item of items) {
            await rejects(render([item]), /limit convert item is missing/, item);
        }
        strictEqual(log.mock.callCount(), items.length);
        for (const call of log.mock.calls) {
            match(call.arguments[0].message, /定义的限制值有错误/);
        }
    });
});

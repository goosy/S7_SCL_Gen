/* eslint-disable no-undef */
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { readFile, rm } from 'node:fs/promises';
import { posix } from 'node:path';
import { mock, suite, test } from 'node:test';
import { convert } from '../src/index.js';
import { match_all } from '../src/rules/index.js';
import { context, write_file } from '../src/util.js';

process.chdir(import.meta.dirname);
context.work_path = process.cwd().replace(/\\/g, '/');
context.silent = true;
context.no_convert = true;
context.no_copy = true;

const yaml = `
name: S7CPU-CPU
platform: step7
files:
- test.yaml
- {filename: test.yaml, line_ending: LF}
- {filename: test.yaml, IE: gbk}
- {filename: test.yaml, OE: utf8}
---
name: TPCPU-CPU
platform: portal
files:
- {filename: test.yaml, IE: gbk}
---
name: OECPU-CPU
platform: portal
options:
  OE: gbk
---
name: OECPU-timer
list:
- {DB: [T1, DB+], PV: 1000}
`;

const warnings = [];
mock.method(console, 'error', (msg) => warnings.push(msg));
const list = await convert({ yaml, filename: 'encoding.yaml' });
mock.restoreAll();

function copies_of(cpu_name) {
    return match_all(list, { type: 'copy', cpu_name, source: 'test.yaml' });
}

suite('output encoding', () => {
    test('CPU.OE defaults by platform', () => {
        const [s7_symbol] = match_all(list, { type: 'convert', cpu_name: 'S7CPU', feature: 'symbol' });
        strictEqual(s7_symbol.OE, 'gbk');
        const [tp_symbol] = match_all(list, { type: 'convert', cpu_name: 'TPCPU', feature: 'symbol' });
        strictEqual(tp_symbol.OE, 'utf8bom');
    });

    test('options.OE overrides the platform default', () => {
        const [symbol] = match_all(list, { type: 'convert', cpu_name: 'OECPU', feature: 'symbol' });
        strictEqual(symbol.OE, 'gbk');
        const [loop] = match_all(list, { type: 'convert', cpu_name: 'OECPU', feature: 'timer' });
        strictEqual(loop.OE, 'gbk');
        const [lib] = match_all(list, { type: 'copy', cpu_name: 'OECPU', feature: 'timer' });
        strictEqual(lib.IE, 'utf8');
        strictEqual(lib.OE, 'gbk');
    });

    test('files entries without IE and OE are copied verbatim', () => {
        const [plain, with_le] = copies_of('S7CPU');
        strictEqual(plain.IE, null);
        strictEqual(with_le.IE, null);
    });

    test('files entries with IE or OE are converted', () => {
        const [, , ie_only, oe_only] = copies_of('S7CPU');
        deepStrictEqual([ie_only.IE, ie_only.OE], ['gbk', 'gbk']);
        deepStrictEqual([oe_only.IE, oe_only.OE], ['utf8', 'utf8']);
        const [tp_ie_only] = copies_of('TPCPU');
        deepStrictEqual([tp_ie_only.IE, tp_ie_only.OE], ['gbk', 'utf8bom']);
    });

    test('ignored line_ending emits a warning', () => {
        const hits = warnings.filter(msg => /line_ending/.test(msg));
        strictEqual(hits.length, 1);
        ok(hits[0].includes('test.yaml'));
    });
});

suite('write_file encoding', () => {
    const dir = posix.join(context.work_path, 'dist_encoding');
    const content = 'A中';

    test('utf8bom and utf8-bom prepend a BOM', async () => {
        for (const encoding of ['utf8bom', 'utf8-bom']) {
            const filename = posix.join(dir, `${encoding}.txt`);
            await write_file(filename, content, { encoding, line_ending: 'LF' });
            const buff = await readFile(filename);
            deepStrictEqual([...buff], [0xEF, 0xBB, 0xBF, 0x41, 0xE4, 0xB8, 0xAD]);
        }
    });

    test('defaults to utf8 without BOM', async () => {
        const filename = posix.join(dir, 'default.txt');
        await write_file(filename, content, { line_ending: 'LF' });
        const buff = await readFile(filename);
        deepStrictEqual([...buff], [0x41, 0xE4, 0xB8, 0xAD]);
        await rm(dir, { recursive: true, force: true });
    });
});

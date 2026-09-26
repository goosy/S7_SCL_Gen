import { deepStrictEqual, match, rejects, ok } from "node:assert/strict";
import { suite, test } from 'node:test';
import { gen_data } from '../src/gen_data.js';
import { context } from '../src/util.js';

context.silent = true;

const POLLS = '[{recv_DB: R1, recv_start: 0, unit_ID: 1, func_code: 3, address: 0, length: 2}]';

/**
 * Build a CPU document plus an MT document with one connection per entry.
 * @param {string|null} cpu_device device of the CPU document, null to omit it
 * @param {string[]} conns extra flow-mapping keys of each connection, e.g. 'xslot: 4'
 */
function make_yaml(cpu_device, conns) {
    const device_line = cpu_device ? `device: ${cpu_device}` : '';
    const list = conns.map((extra, i) => {
        const keys = [`DB: [conn_${i}, DB${11 + i}]`, `host: 10.0.0.${i + 1}`, 'port: 502'];
        if (extra) keys.push(extra);
        keys.push(`polls: ${POLLS}`);
        return `- {${keys.join(', ')}}`;
    });
    return `---
name: T-CPU
${device_line}
---
name: T-MT
symbols:
- [R1, DB20]
list:
${list.join('\n')}
`;
}

async function device_ids(cpu_device, conns) {
    const items = await gen_data({ yaml: make_yaml(cpu_device, conns) });
    const mt = items.find(item => item.feature === 'MT' && item.type === 'convert');
    ok(mt, 'MT convert item is missing');
    return mt.tags.list.map(conn => conn.local_device_id);
}

suite('MT local_device_id', () => {
    test('models without rack or slot', async () => {
        deepStrictEqual(await device_ids('IM151-8_PN/DP', ['']), ['B#16#01']);
        deepStrictEqual(await device_ids('CPU315T-3_PN/DP', ['']), ['B#16#03']);
        deepStrictEqual(await device_ids('CPU416-3_PN/DP', ['']), ['B#16#05']);
    });

    test('CPU document without device falls back to CPU31x-2_PN/DP', async () => {
        deepStrictEqual(await device_ids(null, ['']), ['B#16#02']);
    });

    test('multi-IF models accept an omitted xslot', async () => {
        deepStrictEqual(
            await device_ids('CPU317-2_PN/DP', ['', 'xslot: 2', 'xslot: 4']),
            ['B#16#02', 'B#16#02', 'B#16#04'],
        );
        deepStrictEqual(
            await device_ids('CPU319-3_PN/DP', ['', 'xslot: 3', 'xslot: 4']),
            ['B#16#03', 'B#16#03', 'B#16#04'],
        );
    });

    test('redundant models combine rack and xslot', async () => {
        deepStrictEqual(
            await device_ids('CPU410-5H', [
                '', 'rack: 0', 'rack: 1', 'xslot: 8',
                'rack: 0, xslot: 8', 'rack: 1, xslot: 5', 'rack: 1, xslot: 8',
            ]),
            ['B#16#05', 'B#16#05', 'B#16#15', 'B#16#08', 'B#16#08', 'B#16#15', 'B#16#18'],
        );
        deepStrictEqual(
            await device_ids('CPU414-5H_PN/DP', ['rack: 1', 'rack: 1, xslot: 5']),
            ['B#16#15', 'B#16#15'],
        );
    });

    test('legacy key XSlot is an alias of xslot', async () => {
        deepStrictEqual(await device_ids('CPU317-2_PN/DP', ['XSlot: 4']), ['B#16#04']);
    });

    test('connection device overrides CPU device', async () => {
        deepStrictEqual(
            await device_ids('CPU317-2_PN/DP', ['device: CPU410-5H, rack: 1, xslot: 8', '']),
            ['B#16#18', 'B#16#02'],
        );
    });

    test('local_device_id overrides device, rack and xslot', async () => {
        deepStrictEqual(
            await device_ids('CPU317-2_PN/DP', ['local_device_id: B#16#0F, device: unknown, rack: 9']),
            ['B#16#0F'],
        );
    });

    test('rack or xslot the model does not take is an error', async () => {
        await rejects(
            device_ids('CPU317-2_PN/DP', ['rack: 0']),
            { name: 'SyntaxError', message: /"CPU317-2_PN\/DP R0"/ },
        );
        await rejects(
            device_ids('IM151-8_PN/DP', ['xslot: 2']),
            { name: 'SyntaxError', message: /"IM151-8_PN\/DP X2"/ },
        );
        await rejects(
            device_ids('CPU410-5H', ['rack: 2']),
            { name: 'SyntaxError', message: /"CPU410-5H R2"/ },
        );
    });

    test('unknown device is an error', async () => {
        await rejects(
            device_ids('CPU317-2_PN/DP', ['device: CPU999']),
            { name: 'SyntaxError', message: /"CPU999"/ },
        );
    });

    test('local_device_id must be an SCL byte literal', async () => {
        // parse_conf reports errors of the first scan through console.log
        const original = console.log;
        const logs = [];
        console.log = (...args) => logs.push(args.map(String).join(' '));
        try {
            await gen_data({ yaml: make_yaml('CPU317-2_PN/DP', ['local_device_id: 0x0F']) });
        } finally {
            console.log = original;
        }
        match(logs.join('\n'), /SyntaxError: .*"local_device_id: 15"/);
    });
});

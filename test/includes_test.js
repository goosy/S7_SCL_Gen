import { doesNotMatch, match, ok } from "node:assert/strict";
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, suite, test } from 'node:test';
import { gen_data } from '../src/gen_data.js';
import { context } from '../src/util.js';

context.silent = true;

suite('includes files', () => {
    const origin_work_path = context.work_path;
    let temp_dir;

    before(async () => {
        temp_dir = await mkdtemp(join(tmpdir(), 's7scl-includes-'));
        // `(**` must stand alone at the start of a line
        await writeFile(join(temp_dir, 'bad.scl'), 'BAD_CODE := 1;\n(** comment **)\n');
        await writeFile(join(temp_dir, 'good.scl'), 'GOOD_CODE := 1;\n(**\nhidden\n**)\n');
        context.work_path = temp_dir.replace(/\\/g, '/');
    });

    after(async () => {
        context.work_path = origin_work_path;
        await rm(temp_dir, { recursive: true, force: true });
    });

    test('malformed file is skipped and reported, others are kept', async t => {
        const log = t.mock.method(console, 'error', () => { });
        const yaml = `---
name: T-CPU
platform: step7
---
name: T-RP
includes: [bad.scl, good.scl]
list: []
`;
        const list = await gen_data({ yaml });
        const rp = list.find(item => item.feature === 'RP' && item.type === 'convert');
        ok(rp, 'RP convert item is missing');
        const includes = rp.tags.includes;
        match(includes, /GOOD_CODE := 1;/);
        doesNotMatch(includes, /hidden/);
        doesNotMatch(includes, /BAD_CODE/);

        const messages = log.mock.calls.map(call => String(call.arguments[0]));
        ok(messages.some(msg => msg.includes('bad.scl')), 'error message should name the file');
        ok(!messages.some(msg => msg.includes('good.scl')), 'good file should not be reported');
    });
});

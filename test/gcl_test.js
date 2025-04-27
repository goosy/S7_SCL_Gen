import { ok, strictEqual } from "node:assert/strict";
import { suite, test } from 'node:test';
import { gen_data } from '../src/gen_data.js';

async function test_exit(fn, code) {
    const original = process.exit;
    let exit_code;
    process.exit = (code) => {
        exit_code = code;
    };
    try {
        await fn();
        strictEqual(exit_code, code);
    } finally {
        process.exit = original;
    }
}

suite('GCL测试', () => {
    test('符号测试', async () => {
        await test_exit(async () => {
            const yaml = `---
name: test-AI
symbols:
- [same_addr_with_AI_Proc, FB512]
list:
- comment: test
  DB: [my_db, DB1]
`;
            await gen_data({ yaml });
        }, 10);
    });
});

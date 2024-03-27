import { strictEqual } from "node:assert/strict";
import { posix } from "node:path";
import { fileURLToPath } from 'node:url';
import { pad_left, pad_right, get_template } from '../src/util.js';
import { get_rules } from "../src/rules.js";

const curr_dir = posix.dirname(fileURLToPath(import.meta.url));

describe('util test', () => {
    it('pad_left test', () => {
        strictEqual(pad_left('abcdef', 20), '              abcdef');
        strictEqual(pad_left('abcdef', 4), 'cdef');
        strictEqual(pad_left('abcdef', 15, '*'), '*********abcdef');
    })
    it('pad_right test', () => {
        strictEqual(pad_right('abcdef', 20), 'abcdef              ');
        strictEqual(pad_right('abcdef', 4), 'abcd');
        strictEqual(pad_right('abcdef', 15, '*'), 'abcdef*********');
    })
    it('get_template test', async () => {
        strictEqual(await get_template('test/test.template'), '测试: {{LOOP_NAME}}\n文件: {{gcl.file}}');
    })
    it('get_rules test', async () => {
        const tasks = await get_rules(posix.resolve(curr_dir, 'yaml/rules.yaml'));
        strictEqual(tasks.length, 2);
        const task = tasks[0];
        strictEqual(task.path, '/codes/AS/S7_SCL_Gen/test');
        const rules = task.rules;
        strictEqual(rules.length, 3);
        const rule = rules[1];
        strictEqual(rule.pattern.type, 'convert');
        strictEqual(rule.modifications.template, '测试: {{LOOP_NAME}}\n文件: {{gcl.file}}');
    })
});

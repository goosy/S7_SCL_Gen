/* eslint-disable no-undef */
import { ok, strictEqual } from "node:assert/strict";
import { access, unlink } from 'node:fs/promises';
import { suite, test } from 'node:test';
import { convert } from '../src/index.js';
import { match_all } from '../src/rules/index.js';
import { context, read_file } from '../src/util.js';

// Set up the main conversion environment
process.chdir(import.meta.dirname);
context.work_path = process.cwd().replace(/\\/g, '/');
context.silent = true;
context.no_convert = true;
context.no_copy = true;

async function checkAndDeleteFiles(files) {
    const existencePromises = files.map(async (filename) => {
        try {
            await access(filename);
            return true;
        } catch (error) {
            return false;
        }
    });

    const allExist = (await Promise.all(existencePromises)).every(result => result);
    if (allExist) {
        await Promise.all(files.map(filename =>
            unlink(filename)
        ));
    }
    return allExist;
}

// Loading rules
const rules = await convert();

suite('生成SCL测试', () => {
    test('复制指定文件', async () => {
        const source = '**/AI_Proc(step7).scl';
        let items = match_all(rules, {
            type: 'copy',
            cpu_name: 'dist',
            feature: 'AI',
            source,
        });
        for (const item of items) {
            strictEqual(item.distance, 'dist/AI_Proc.scl');
        }
        items = match_all(rules, {
            type: 'copy',
            cpu_name: 'dist',
            distance: '**/test.yaml',
        });
        for (const item of items) {
            strictEqual(item.feature, 'AI');
        }
        const src_file = `${context.work_path}/test.yaml`;
        const test_yaml_content = await read_file(src_file);
        items = match_all(rules, {
            type: 'copy',
            cpu_name: 'dist',
            source: '**/test.yaml',
        });
        for (const item of items) {
            strictEqual(item.content, test_yaml_content);
        }
        const do_copy = await checkAndDeleteFiles([
            `${context.work_path}/dist/AI_Proc.scl`,
            `${context.work_path}/dist/Alarm_Proc.scl`,
            `${context.work_path}/dist/test.yaml`,
        ])
        ok(!do_copy);
    });
    test('检查指定属性', () => {
        let items = match_all(rules, {
            type: 'copy',
            feature: 'CPU',
        });
        for (const item of items) {
            strictEqual(item.CPU, 'dist');
        }
        items = match_all(rules, {
            type: 'copy',
            feature: 'AI',
        });
        ok(items.length > 0);
        items = match_all(rules, {
            type: 'copy',
            platform: 'step7',
        });
        ok(items.length > 0);
    });
    test('生成指定文件', () => {
        let output = match_all(rules, {
            type: 'convert',
            feature: 'AI',
            cpu_name: 'dist',
        });
        ok(output.length > 0);
        output = match_all(rules, {
            type: 'convert',
            feature: 'alarm',
            cpu_name: 'dist',
        });
        ok(output.length > 0);
        output = match_all(rules, {
            type: 'convert',
            distance: '**/*.asc',
        });
        ok(output.length > 0);
    });
});

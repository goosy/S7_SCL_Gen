/* eslint-disable no-undef */
import { equal, ok, strictEqual } from "node:assert/strict";
import { posix } from 'node:path';
import { chdir, cwd } from 'node:process';
import { convert } from '../src/index.js';
import { get_rules, match_list } from '../src/rules.js';
import { context, read_file } from '../src/util.js';

// Loading rules
const base_path = cwd().replace(/\\/g, '/');
const tasks = await get_rules('./test/rules.rml');

// Set up the main conversion environment
chdir('./test');
context.work_path = cwd().replace(/\\/g, '/');
context.silent = true;
context.noconvert = true;
const list = [];

// Example 1
list.push(await convert());

// Example 2 3 for rulers
const template = await read_file('template.md');
for (const { path, rules } of tasks) {
    process.chdir(posix.join(base_path, path));
    context.work_path = process.cwd().replace(/\\/g, '/');
    list.push(await convert(rules));
}

const test_content = `# 联校调试记录

工程名称： PLC测试
测试内容： 通道联调

[PLC测试表格]
| 回路 | 仪表位号 | 测量范围 | 实测值 0% | 实测值 50% | 实测值 100% | 报警值 | 调试结果 |
| --- | --- | :---: | --- | --- | --- | --- | --- |
| | TIT101 |  0.0 - 100.0 | 0.000 | 50.000 | 100.000 |  | 合格 |

调试单位: __________________________ 专业工程师: ________ 质量检查员: ________ 施工班组长: ________
日期: ________ 年 ____ 月 ____ 日
`

describe('生成SCL测试', () => {
    describe('规则载入', () => {
        it('get_rules test', async () => {
            strictEqual(tasks.length, 2);
            const task = tasks[0];
            strictEqual(task.path, 'test');
            // To test the path of rules in each task, the current directory must first enter task.path
            const rules = task.rules;
            strictEqual(rules.length, 3);
            strictEqual(rules[0].pattern.type, 'copy');
            strictEqual(rules[1].modifications.template, template);
            strictEqual(rules[1].modifications.distance, '{{title[cpu_name]}}.md');
            strictEqual(rules[2].modifications.output_dir, 'target');
        })
    });
    describe('配置正确转换', () => {
        it('复制指定文件', async () => {
            const source = '**/AI_Proc(step7).scl';
            let items = match_list(list[0].copy_list, {
                cpu_name: 'dist',
                feature: 'AI',
                source,
            });
            for (const item of items) {
                equal(item.distance, 'dist/AI_Proc.scl');
            }
            items = match_list(list[0].copy_list, {
                cpu_name: 'dist',
                distance: '**/test.yaml',
            });
            for (const item of items) {
                equal(item.feature, 'AI');
            }
            const src_file = `${context.work_path}/test.yaml`;
            items = match_list(list[0].copy_list, {
                cpu_name: 'dist',
                source: '**/test.yaml',
            });
            for (const item of items) equal(item.content, await read_file(src_file));
        });
        it('检查指定属性', () => {
            for (const item of match_list(list[0].copy_list, { feature: 'CPU', })) {
                equal(item.CPU, 'dist');
            }
            ok(match_list(list[0].copy_list, { feature: 'AI', }).length);
            ok(match_list(list[0].copy_list, { platform: 'step7', }).length);
        });
        it('生成指定文件', () => {
            const AI_out = match_list(list[1].convert_list, {
                feature: 'AI',
                distance: '**.md',
            });
            ok(AI_out.length);
            equal(AI_out[0].output_dir, 'target');
            for (const item of AI_out) equal(item.content, test_content);
            ok(match_list(
                list[1].convert_list,
                { cpu_name: 'dist', distance: '**/alarms.csv', }
            ).length);
        });
    });
});

/* eslint-disable no-undef */
import { equal, ok, strictEqual } from "node:assert/strict";
import { posix } from 'node:path';
import { chdir, cwd } from 'node:process';
import { access, unlink } from 'node:fs/promises';
import { convert } from '../src/index.js';
import { get_rules, array_match } from '../src/rules.js';
import { context, read_file } from '../src/util.js';

// Loading rules
const base_path = cwd().replace(/\\/g, '/');
const tasks = await get_rules('./test/rules.rml');

// Set up the main conversion environment
chdir('./test');
context.work_path = cwd().replace(/\\/g, '/');
context.silent = true;
context.no_convert = true;
context.no_copy = true;
const list = [];
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

// Example 1
list.push(await convert());

// Example 2 3 4 for rulers
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
`;

const merge_content = `# 联校调试记录

工程名称： 合并测试
测试内容： 通道联调

[合并测试表格]
| 回路 | 仪表位号 | 测量范围 | 实测值 0% | 实测值 50% | 实测值 100% | 报警值 | 调试结果 |
| --- | --- | :---: | --- | --- | --- | --- | --- |
| | TIT101 |  0.0 - 100.0 | 0.000 | 50.000 | 100.000 |  | 合格 |
| | LIT001 |  0.0 - 100.0 | 0.100 | 50.100 | 99.900 |  | 合格 |

调试单位: __________________________ 专业工程师: ________ 质量检查员: ________ 施工班组长: ________
日期: ________ 年 ____ 月 ____ 日
`;

describe('生成SCL测试', () => {
    it('规则加载', async () => {
        strictEqual(tasks.length, 3);
        const task = tasks[0];
        strictEqual(task.path, 'test');
        // To test the path of rules in each task, the current directory must first enter task.path
        let rules = task.rules;
        strictEqual(rules.length, 3);
        strictEqual(rules[0].pattern.type, 'copy');
        strictEqual(rules[1].modify.template, 'template.md');
        strictEqual(rules[1].modify.distance, '{{title[cpu_name]}}.md');
        strictEqual(rules[2].modify.output_dir, 'target');
        rules = tasks[1].rules;
        strictEqual(rules.length, 2);
        strictEqual(rules[0].merge.template, 'template.md');
        strictEqual(rules[0].merge.distance, 'AI_alarm.md');
        strictEqual(rules[0].merge.output_dir, '{{cpu_name}}');
        strictEqual(rules[1].modify, 'delete');
    })
    it('复制指定文件', async () => {
        const source = '**/AI_Proc(step7).scl';
        let items = array_match(list[0].copy_list, {
            cpu_name: 'dist',
            feature: 'AI',
            source,
        });
        for (const item of items) {
            equal(item.distance, 'dist/AI_Proc.scl');
        }
        items = array_match(list[0].copy_list, {
            cpu_name: 'dist',
            distance: '**/test.yaml',
        });
        for (const item of items) {
            equal(item.feature, 'AI');
        }
        const src_file = `${context.work_path}/test.yaml`;
        const test_yaml_content = await read_file(src_file);
        items = array_match(list[0].copy_list, {
            cpu_name: 'dist',
            source: '**/test.yaml',
        });
        for (const item of items) equal(item.content, test_yaml_content);
        const do_copy = await checkAndDeleteFiles([
            `${context.work_path}/dist/AI_Proc.scl`,
            `${context.work_path}/dist/Alarm_Proc.scl`,
            `${context.work_path}/dist/test.yaml`,
        ])
        ok(!do_copy);
    });
    it('检查指定属性', () => {
        for (const item of array_match(list[0].copy_list, { feature: 'CPU', })) {
            equal(item.CPU, 'dist');
        }
        ok(array_match(list[0].copy_list, { feature: 'AI', }).length);
        ok(array_match(list[0].copy_list, { platform: 'step7', }).length);
    });
    it('生成指定文件', () => {
        let AI_out = array_match(list[0].convert_list, {
            feature: 'AI',
            cpu_name: 'dist',
        });
        ok(AI_out.length);
        AI_out = array_match(list[0].convert_list, {
            feature: 'alarm',
            cpu_name: 'dist',
        });
        ok(AI_out.length);
        AI_out = array_match(list[0].convert_list, {
            distance: '**/alarms.csv',
        });
        ok(AI_out.length);
        AI_out = array_match(list[0].convert_list, {
            distance: '**/*.asc',
        });
        ok(AI_out.length);
        AI_out = array_match(list[1].convert_list, {
            feature: 'AI',
            cpu_name: 'dist',
        });
        ok(AI_out.length);
        for (const item of AI_out) {
            equal(item.distance, 'PLC测试.md');
            equal(item.output_dir, '/codes/AS/S7_SCL_Gen/test/target');
            equal(item.content, test_content);
        }
        AI_out = array_match(list[2].convert_list, {
            template,
            distance: 'AI_alarm.md',
            output_dir: '/codes/AS/S7_SCL_Gen/test/dist',
            content: merge_content,
        });
        ok(AI_out.length);
    });
});

import { ok, strictEqual } from "node:assert/strict";
import { posix } from 'node:path';
import { suite, test } from 'node:test';
import { convert } from '../src/index.js';
import { get_rules, match, match_all, parse_rules } from '../src/rules/index.js';
import { context, read_file } from '../src/util.js';

// set up the main conversion environment
process.chdir(import.meta.dirname);
context.work_path = process.cwd().replace(/\\/g, '/');
context.silent = true;
context.no_convert = true;
context.no_copy = true;

const replace_content = `# 联校调试记录

工程名称： 替换测试
测试内容： 通道联调

[替换测试表格]
| 回路 | 仪表位号 | 测量范围 | 实测值 0% | 实测值 50% | 实测值 100% | 报警值 | 调试结果 |
| --- | --- | :---: | --- | --- | --- | --- | --- |
| | TIT101 |  0.0 - 100.0 | 0.000 | 50.000 | 100.000 |  | 合格 |

调试单位: __________________________ 专业工程师: ________ 质量检查员: ________ 施工班组长: ________
日期: ________ 年 ____ 月 ____ 日
`;

const merge_content = `# 联校调试记录

工程名称： 合并与新建测试
测试内容： 通道联调

[合并与新建测试表格]
| 回路 | 仪表位号 | 测量范围 | 实测值 0% | 实测值 50% | 实测值 100% | 报警值 | 调试结果 |
| --- | --- | :---: | --- | --- | --- | --- | --- |
| | TIT101 |  0.0 - 100.0 | 0.000 | 50.000 | 100.000 |  | 合格 |
| | LIT001 |  0.0 - 100.0 | 0.100 | 50.100 | 99.900 |  | 合格 |

调试单位: __________________________ 专业工程师: ________ 质量检查员: ________ 施工班组长: ________
日期: ________ 年 ____ 月 ____ 日
`;

const yaml = `---
config_path: .
rules:
- pattern: "*"
  actions:
  - ~ # 无效动作
  - action: ~ # 无效动作
  - action: replace # 由于存在delete，此动作将被忽略
    host: '*'
  - action: merge # 有效动作
    cpu_name: as1
  - delete # 有效动作
  - action: join # 由于存在delete，此动作将被忽略
    files: [sample.scl]
- pattern:
    type: copy
  actions: delete

---
# 空任务

---
config_path: .
# 空规则

---
config_path: .
rules: # 无效规则
- actions: invaild

...`;

// loading rules
const base_path = context.work_path;
const tasks = await get_rules('./rules.rml');

// generating for rulers
const list = [];
const template = await read_file('template.md');
for (const { path, rules } of tasks) {
    process.chdir(posix.join(base_path, path));
    context.work_path = process.cwd().replace(/\\/g, '/');
    list.push(await convert(rules));
}

suite('rule test', () => {
    test('match', () => {
        // null
        ok(!match(null, '*'));
        ok(match(null, '%u'));
        ok(match({}, '*'));
        ok(match([], '*'));
        ok(!match({}, []));
        ok(!match([], []));
        ok(!match({}));
        ok(!match([], null));
        // boolean
        ok(match(true, '%b'));
        ok(match(false, '%b'));
        ok(!match(0, '%b'));
        ok(!match({}, '%b'));
        ok(!match([], '%b'));
        ok(!match('', '%b'));
        // string
        ok(match('', '%s'));
        ok(!match({}, '%s'));
        ok(!match([], '%s'));
        ok(!match(0, '%s'));
        ok(!match(true, '%s'));
        ok(match('abcdef', 'abcdef'));
        ok(match('abcdef', ['4', 'ab*']));
        ok(!match(['abcdef', 'foo'], 'b*'));
        ok(match(['abcdef', 'foo'], ['f*', 'b*']));
        // number
        ok(match(0, '%n'));
        ok(match(123, '%n'));
        ok(match(123.456, '%n'));
        ok(match(123.456, 123.456));
        ok(!match(123.456, 123));
        ok(!match(true, '%n'));
        ok(!match('', '%n'));
        ok(!match({}, '%n'));
        ok(!match([], '%n'));
        // array
        ok(match([], '%a'));
        ok(!match(0, '%a'));
        ok(!match('', '%a'));
        ok(!match(true, '%a'));
        ok(!match({}, '%a'));
        // object
        ok(match({}, '%o'));
        ok(match(
            { str: 'abcdef', foo: 'foo' },
            { str: '*', foo: 'foo' }
        ));
        ok(!match('', '%o'));
        ok(!match([], '%o'));
        ok(!match(0, '%o'));
        ok(!match(true, '%o'));
    });
    test('match_all', () => {
        strictEqual(
            match_all(['fee', 'foo', 'doo', 'fum', 'zoo'], 'f*').join(', '),
            'fee, foo, fum'
        );
        strictEqual(
            match_all(['fee', 'foo', 'doo', 'fum', 'zoo'], ['f*', 'd*']).join(', '),
            'fee, foo, doo, fum'
        );
    });
    test('parse', () => {
        const tasks = parse_rules(yaml, 'test');
        strictEqual(tasks.length, 1);
        const task = tasks[0];
        strictEqual(task.path, 'test');
        strictEqual(task.rules.length, 2);
        // To test the path of rules in each task, the current directory must first enter task.path
        let rule = task.rules[0];
        strictEqual(rule.actions.length, 2);
        strictEqual(rule.pattern, '*');
        rule = task.rules[1];
        strictEqual(rule.actions.length, 1);
    });
    test('load', async () => {
        strictEqual(tasks.length, 3);
        const task = tasks[0];
        strictEqual(task.path, '.');
        // To test the path of rules in each task, the current directory must first enter task.path
        let rules = task.rules;
        strictEqual(rules.length, 3);
        strictEqual(rules[0].pattern.type, 'copy');
        strictEqual(rules[1].actions[0].template, 'template.md');
        strictEqual(rules[1].actions[0].distance, '{{title[$.cpu_name]}}.md');
        strictEqual(rules[2].actions[0].output_dir, 'target');
        rules = tasks[1].rules;
        strictEqual(rules.length, 3);
        strictEqual(rules[0].actions[0].template, 'template.md');
        strictEqual(rules[0].actions[0].distance, 'AI_alarm.md');
        strictEqual(rules[0].actions[0].output_dir, '{{$.cpu_name}}');
        strictEqual(rules[1].actions[0].action, 'add');
        strictEqual(rules[2].actions[0].action, 'delete');
    });
    test('generate', async () => {
        let output = match_all(list[0].convert_list, {
            feature: 'AI',
            cpu_name: 'dist',
        });
        ok(output.length);
        for (const item of output) {
            strictEqual(item.distance, '替换测试.md');
            strictEqual(item.output_dir, 'D:/codes/AS/S7_SCL_Gen/test/target');
            strictEqual(item.content, replace_content);
        }
        output = match_all(list[1].convert_list, {
            feature: 'OS_alarms',
            template,
            distance: 'AI_alarm.md',
            output_dir: 'D:/codes/AS/S7_SCL_Gen/test/dist',
            content: merge_content,
        });
        ok(output.length);
        output = match_all(list[1].copy_list, {
            cpu_name: 'dist',
            feature: 'OS_alarms',
            platform: 'step7',
            input_dir: 'D:/codes/AS/S7_SCL_Gen/test',
            output_dir: 'D:/codes/AS/S7_SCL_Gen/test/dist',
            source: 'template.md',
            distance: 'template',
        });
        ok(output.length);
        output = match_all(list[2].copy_list, {
            replace_a: ['new'],
            replace_o: { type: 'replace' },
            join_a: ['old', 'new'],
            join_o: { desc: 'join object', type: 'join' }
        });
        ok(output.length);
    });
    test('delete', () => {
        let output = match_all(list[0].convert_list, {
            type: 'copy',
        });
        strictEqual(output.length, 0);
        output = match_all(list[1].convert_list, {
            feature: '!OS_alarms',
        });
        strictEqual(output.length, 0);
    })
});

import { suite, test } from 'node:test';
import { ok, strictEqual } from "node:assert/strict";
import { match, match_all, parse_rules } from '../src/rules/index.js';

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
});

import { doesNotMatch, match, ok, rejects, strictEqual } from "node:assert/strict";
import { suite, test } from 'node:test';
import { convert as gc } from 'gooplate';
import { gen_data } from '../src/gen_data.js';
import { WRONGTYPESYMBOLS } from '../src/symbols.js';
import { context } from '../src/util.js';

context.silent = true;

/**
 * Build a CPU document plus an interlock document.
 * @param {string} list the YAML text of the `list` sequence
 */
function make_yaml(list) {
    return `---
name: T-CPU
platform: step7
---
CPU: T
feature: interlock
list:
${list}
`;
}

async function render(list) {
    const items = await gen_data({ yaml: make_yaml(list) });
    const il = items.find(item => item.feature === 'interlock' && item.type === 'convert');
    ok(il, 'interlock convert item is missing');
    return gc(il.tags, il.template);
}

/**
 * Convert a configuration expected to fail in pass 1, return the logged error message
 */
async function convert_error(t, list) {
    // Pass-1 errors are caught and logged by gen_data, which then stops
    const log = t.mock.method(console, 'log', () => { });
    const items = await gen_data({ yaml: make_yaml(list) });
    ok(!items?.some(item => item.feature === 'interlock'), 'conversion should fail');
    strictEqual(log.mock.callCount(), 1);
    return log.mock.calls[0].arguments[0].message;
}

function count(text, pattern) {
    return text.match(new RegExp(pattern, 'g'))?.length ?? 0;
}

suite('interlock groups', () => {
    test('a list item without groups is a single group', async () => {
        const scl = await render(`
- DB: [IL_a, DB10]
  comment: alarm
  data: [test]
  input: [test]
  output: ['"X".o']`);
        strictEqual(count(scl, 'IF NOT "IL_a".enable THEN'), 1);
        match(scl, /output := "IL_a"\.test AND NOT "IL_a"\.b_1_fo;/);
        match(scl, /"X"\.o := TRUE;/);
        match(scl, /\/\/ alarm\nDATA_BLOCK "IL_a"/);
    });

    test('groups share the DB enable, data and edge numbering', async () => {
        const scl = await render(`
- DB: [IL_pump, DB10]
  comment: pump by level
  enable: '"X".en'
  data: [start, stop, {name: run_cmd, write: '"P".cmd'}]
  groups:
  - comment: start on high level
    input: [start]
    output: [run_cmd]
  - comment: stop on low level
    input: [stop]
    output: [{value: run_cmd, inversion: true}]`);
        strictEqual(count(scl, '"IL_pump".enable := "X".en;'), 1);
        strictEqual(count(scl, 'IF NOT "IL_pump".enable THEN'), 2);
        strictEqual(count(scl, '\nDATA_BLOCK '), 1);
        match(scl, /\/\/ start on high level\n/);
        match(scl, /\/\/ stop on low level\n/);
        match(scl, /output := "IL_pump"\.start AND NOT "IL_pump"\.b_1_fo;/);
        match(scl, /output := "IL_pump"\.stop AND NOT "IL_pump"\.b_2_fo;/);
        match(scl, /b_1_fo : BOOL ;[^\n]*\n\s*b_2_fo : BOOL ;/);
        strictEqual(count(scl, '"P".cmd := "IL_pump".run_cmd;'), 1);
    });

    test('every group can reference any data item of its DB', async () => {
        const scl = await render(`
- DB: [IL_a, DB10]
  data: [first, last]
  groups:
  - input: [last]
    output: [first]
  - input: [first]
    output: [last]`);
        match(scl, /output := "IL_a"\.last AND NOT "IL_a"\.b_1_fo;/);
        match(scl, /output := "IL_a"\.first AND NOT "IL_a"\.b_2_fo;/);
    });

    test('DBs are generated in list order', async () => {
        const scl = await render(`
- DB: [IL_b, DB11]
  input: ['"X".b']
- DB: [IL_a, DB10]
  input: ['"X".a']`);
        ok(scl.indexOf('DATA_BLOCK "IL_b"') < scl.indexOf('DATA_BLOCK "IL_a"'));
        ok(scl.indexOf('"X".b AND') < scl.indexOf('"X".a AND'));
    });

});

suite('interlock comments', () => {
    /**
     * Convert the list, return the rendered SCL and the comment of the DB symbol
     */
    async function convert(list) {
        const items = await gen_data({ yaml: make_yaml(list) });
        const il = items.find(item => item.feature === 'interlock' && item.type === 'convert');
        const symbols = items.find(item => item.feature === 'symbol').tags.list;
        const symbol = symbols.find(symbol => symbol.name === 'IL_a');
        return { scl: gc(il.tags, il.template), symbol_comment: symbol.comment };
    }

    test('the list item comment is shown before the symbol comment', async () => {
        const { scl, symbol_comment } = await convert(`
- DB: [IL_a, DB10, ~, symbol comment]
  comment: DB comment
  input: ['"X".a']`);
        match(scl, /\/\/ DB comment\nDATA_BLOCK "IL_a"/);
        strictEqual(symbol_comment, 'symbol comment');
    });

    test('each DB section of the loop starts with a header line', async () => {
        const { scl } = await convert(`
- DB: [IL_a, DB10]
  comment: DB comment
  input: ['"X".a']
- DB: [IL_b, DB11]
  input: ['"X".b']`);
        match(scl, /\n\/\/ ===== DB "IL_a": DB comment\n\/\/ 读入\n/);
        match(scl, /\n\/\/ ===== DB "IL_b"\n\/\/ 读入\n/);
        match(scl, /\n\/\/ 写出\n/);
    });

    test('without a list item comment the symbol comment is shown', async () => {
        const { scl } = await convert(`
- DB: [IL_a, DB10, ~, symbol comment]
  groups:
  - comment: group comment
    input: ['"X".a']`);
        match(scl, /\/\/ symbol comment\nDATA_BLOCK "IL_a"/);
    });

    test('a symbol without comment takes the DB comment', async () => {
        const { symbol_comment } = await convert(`
- DB: [IL_a, DB10]
  comment: DB comment
  input: ['"X".a']`);
        strictEqual(symbol_comment, 'DB comment');
    });

    test('a group without comment takes the DB comment', async () => {
        const { scl } = await convert(`
- DB: [IL_a, DB10, ~, symbol comment]
  comment: DB comment
  groups:
  - comment: group comment
    input: ['"X".a']
  - input: ['"X".b']`);
        match(scl, /\/\/ group comment\nIF NOT "IL_a"\.enable/);
        match(scl, /\/\/ DB comment\nIF NOT "IL_a"\.enable/);
    });

    test('the shorthand comment is the DB comment, its group takes it', async () => {
        const { scl } = await convert(`
- DB: [IL_a, DB10, ~, symbol comment]
  comment: DB comment
  input: ['"X".a']`);
        strictEqual(count(scl, '// DB comment\n'), 2);
        doesNotMatch(scl, /symbol comment/);
    });
});

suite('interlock checks', () => {
    test('the DB symbol is forced to a global DB', async () => {
        const items = await gen_data({
            yaml: make_yaml(`
- DB: [IL_a, DB10, IL_FB]
  input: ['"X".a']
symbols:
- [IL_FB, FB10]`)
        });
        const symbols = items.find(item => item.feature === 'symbol').tags.list;
        strictEqual(symbols.find(symbol => symbol.name === 'IL_a').type, 'IL_a');
        ok([...WRONGTYPESYMBOLS].some(symbol => symbol.name === 'IL_a'));
    });

    test('a DB must not repeat', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  input: ['"X".a']
- DB: IL_a
  input: ['"X".b']`);
        match(message, /DB "IL_a" 重复/);
    });

    test('a DB defined in symbols must not be referenced twice', async (t) => {
        const message = await convert_error(t, `
- DB: IL_a
  input: ['"X".a']
- DB: IL_a
  input: ['"X".b']
symbols:
- [IL_a, DB10]`);
        match(message, /DB "IL_a" 重复/);
    });

    test('groups exclude DB-level group keys', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  input: ['"X".a']
  extra_code: '// x'
  groups:
  - input: ['"X".b']`);
        match(message, /有 groups 时，不能在 DB 层设置 input、extra_code/);
    });

    test('groups must be a non-empty sequence of maps', async (t) => {
        for (const groups of ['[]', '~', '{input: ["\\"X\\".a"]}']) {
            const message = await convert_error(t, `
- DB: [IL_a, DB10]
  groups: ${groups}`);
            match(message, /groups 必须是至少有1项的数组/, groups);
            t.mock.restoreAll();
        }
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  groups: ['"X".a']`);
        match(message, /groups 项必须是对象/);
    });

    test('every group needs an input', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  groups:
  - input: ['"X".a']
  - output: ['"X".o']`);
        match(message, /input_list必须有1项以上/);
    });
});

suite('interlock reset', () => {
    test('a group reset accepts a symbol definition', async () => {
        const items = await gen_data({
            yaml: make_yaml(`
- DB: [IL_a, DB10]
  input: ['"X".a']
  reset: [[RS1, I1.0]]
  output: ['"X".o']`)
        });
        const symbols = items.find(item => item.feature === 'symbol').tags.list;
        ok(symbols.some(symbol => symbol.name === 'RS1'), 'RS1 is not defined');
        const il = items.find(item => item.feature === 'interlock' && item.type === 'convert');
        match(gc(il.tags, il.template), /\nreset := "RS1";\n/);
    });

    test('an output reset accepts a symbol definition', async () => {
        const items = await gen_data({
            yaml: make_yaml(`
- DB: [IL_a, DB10]
  input: ['"X".a']
  output:
  - value: '"X".o'
    reset: [RS2, I1.1]`)
        });
        const symbols = items.find(item => item.feature === 'symbol').tags.list;
        ok(symbols.some(symbol => symbol.name === 'RS2'), 'RS2 is not defined');
        const il = items.find(item => item.feature === 'interlock' && item.type === 'convert');
        match(gc(il.tags, il.template), /\n    IF "RS2" THEN\n        "X"\.o := FALSE;\n/);
    });
});

suite('interlock names', () => {
    test('names are compared case-insensitively', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  data: [reset, Reset]
  input: [reset]`);
        match(message, /name:Reset 重复定义或已保留/);
        t.mock.restoreAll();
        const enable_message = await convert_error(t, `
- DB: [IL_a, DB10]
  data: [Enable]
  input: ['"X".a']`);
        match(enable_message, /name:Enable 重复定义或已保留/);
    });

    test('automatic input names skip the taken numbers', async () => {
        const scl = await render(`
- DB: [IL_a, DB10]
  data: [b_1, b_2_fo]
  input: ['"X".a', '"X".b']`);
        match(scl, /"X"\.a AND NOT "IL_a"\.b_3_fo/);
        match(scl, /"X"\.b AND NOT "IL_a"\.b_4_fo/);
        strictEqual(count(scl, '\n    b_1_fo : BOOL'), 0);
    });

    test('enable is not allowed in input, reset and output', async (t) => {
        for (const group of ['input: [enable]', 'input: [\'"X".a\']\n  reset: [Enable]', 'input: [\'"X".a\']\n  output: [enable]']) {
            const message = await convert_error(t, `
- DB: [IL_a, DB10]
  ${group}`);
            match(message, /不能使用 enable/, group);
            t.mock.restoreAll();
        }
    });

    test('a data item that is not BOOL cannot be used as a boolean', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  data: [{name: level, type: INT}]
  input: [level]`);
        match(message, /level 类型为 INT，不能用作布尔值/);
    });
});

suite('interlock input and output checks', () => {
    test('trigger must be a known type', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  input: [{value: '"X".a', trigger: rise}]`);
        match(message, /trigger:rise 无效/);
    });

    test('an input object needs value or and', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  input: [{trigger: on}]`);
        match(message, /input 对象必须有 value 或 and 属性/);
    });

    test('and items must be values', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  input: [{and: ['"X".a', {value: '"X".b'}]}]`);
        match(message, /and 列表的每一项/);
    });

    test('an output object needs value', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  input: ['"X".a']
  output: [{inversion: true}]`);
        match(message, /output 对象必须有 value 属性/);
    });

    test('inputs in an output reset is replaced, even in parentheses', async () => {
        const scl = await render(`
- DB: [IL_a, DB10]
  input: ['"X".a']
  output:
  - {value: '"X".o', reset: 'NOT(inputs)'}
  - {value: '"X".p', reset: '"X".inputs'}`);
        match(scl, /IF NOT\(output\) THEN/);
        match(scl, /IF "X"\.inputs THEN/);
    });

    test('inputs is not allowed in a group reset', async (t) => {
        const message = await convert_error(t, `
- DB: [IL_a, DB10]
  input: ['"X".a']
  reset: [NOT inputs]`);
        match(message, /组级 reset 中不能使用 inputs/);
    });

    test('a data item both output and reset condition gets a warning', async (t) => {
        const error = t.mock.method(console, 'error', () => { });
        await render(`
- DB: [IL_a, DB10]
  data: [ack]
  groups:
  - input: ['"X".a']
    output: [ack]
  - input: ['"X".b']
    reset: [ack]`);
        strictEqual(error.mock.callCount(), 1);
        match(error.mock.calls[0].arguments[0], /data 项 ack 既是输出又是复位条件/);
    });

    test('the DB must be a DB block', async () => {
        await rejects(render(`
- DB: [IL_a, FB5]
  input: ['"X".a']`), /必须是全局 DB 块/);
    });
});

suite('interlock data initial value and enable', () => {
    test('$value is the initial value of a data item, converted by its type', async () => {
        const scl = await render(`
- DB: [IL_a, DB10]
  data:
  - {name: b, $value: true}
  - {name: n, type: INT, $value: -10}
  - {name: f, type: real, $value: 2}
  - {name: w, type: WORD, $value: 255}
  - {name: d, type: DINT, $value: 100000}
  - {name: plain}
  input: [b]`);
        match(scl, /\n    b \{S7_m_c := 'true'\} : BOOL := TRUE ;/);
        match(scl, /\n    n \{S7_m_c := 'true'\} : INT := -10 ;/);
        match(scl, /\n    f \{S7_m_c := 'true'\} : real := 2\.0 ;/);
        match(scl, /\n    w \{S7_m_c := 'true'\} : WORD := W#16#FF ;/);
        match(scl, /\n    d \{S7_m_c := 'true'\} : DINT := L#100000 ;/);
        match(scl, /\n    plain \{S7_m_c := 'true'\} : BOOL ;/);
    });

    test('an invalid $value is an error', async (t) => {
        for (const data of ['{name: n, type: INT, $value: 40000}', '{name: n, type: BYTE, $value: 256}', '{name: n, $value: maybe}']) {
            const message = await convert_error(t, `
- DB: [IL_a, DB10]
  data: [${data}]
  input: ['"X".a']`);
            match(message, /data 项 n 的 \$value 无效/, data);
            t.mock.restoreAll();
        }
    });

    test('enable must be an assignable address', async () => {
        for (const enable of ['false', 'true', `'"X".a AND "X".b'`]) {
            await rejects(render(`
- DB: [IL_a, DB10]
  enable: ${enable}
  input: ['"X".a']`), /enable 必须是可赋值的地址/, enable);
        }
        const scl = await render(`
- DB: [IL_a, DB10]
  enable: '"IL_b".enable'
  input: ['"X".a']`);
        match(scl, /"IL_a"\.enable := "IL_b"\.enable;/);
    });
});

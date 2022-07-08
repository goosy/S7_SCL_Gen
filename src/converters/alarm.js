import { make_prop_symbolic } from '../symbols.js';
export const ALARM_LOOP_NAME = 'Alarm_Loop';
export const ALARM_BUILDIN = `
- [${ALARM_LOOP_NAME}, FC518, ${ALARM_LOOP_NAME}, main alarm cyclic call function]
`;

export function is_type_alarm(type) {
  return type.toLowerCase() === 'alarm';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{#for alarm in list}}
// {{alarm.comment}}
DATA_BLOCK "{{alarm.DB.name}}"
{S7_m_c := 'true'}
STRUCT{{#for input in alarm.declaration}}
  {{input.declaration}} // {{input.comment}}{{#endfor input}}
  output {S7_m_c := 'true'} : BOOL ; // 输入信号上升沿输出{{#for input in alarm.input_list}}
  {{input.name}}_follower : BOOL ; // 用于检测上升沿的追随变量{{#endfor input}}
END_STRUCT;
BEGIN
END_DATA_BLOCK
{{#endfor alarm}}

FUNCTION "alarm_Loop" : VOID
// 联锁保护主循环

VAR_TEMP
  reset : BOOL ; // 复位
  output : BOOL ; // 输出
END_VAR
{{#for alarm in list}}
// {{alarm.comment}}{{#for assign in alarm.assign_list}}
{{assign.assign_str}}{{#endfor assign}}
reset := {{#for no, reset in alarm.reset_list}}{{#if no}} OR {{#endif}}{{reset.edge}}{{#endfor reset}};
output := {{#for no, input in alarm.input_list}}{{#if no}}
  OR {{#endif}}{{input.edge}} AND NOT "{{alarm.DB.name}}".{{input.name}}_follower{{#endfor}};
IF reset THEN
  "{{alarm.DB.name}}".output := FALSE;{{#for output in alarm.output_list}} 
  {{output.value}} := FALSE;{{#endfor output}}
  "{{alarm.DB.name}}".reset := FALSE;
ELSIF output THEN
  "{{alarm.DB.name}}".output := TRUE;
  // 联锁输出{{#for output in alarm.output_list}} 
  {{output.value}} := TRUE;{{#endfor output}}
END_IF;
// inputs{{#for input in alarm.input_list}}
"{{alarm.DB.name}}".{{input.name}}_follower := {{input.edge}};{{#endfor}}{{#if alarm.output}}
// output
{{alarm.output.value}} := "{{alarm.DB.name}}".output;{{#endif alarm.output}}
{{#endfor alarm}}
END_FUNCTION
`

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols_alarm({ CPU, list }) {
  const document = CPU.alarm;
  list.forEach(alarm => {
    if (!alarm.DB) throw new SyntaxError("alarm转换必须有DB块!"); // 空块不处理
    alarm.comment ??= '报警联锁';
    if (Array.isArray(alarm.DB)) alarm.DB[3] ??= alarm.comment;
    make_prop_symbolic(alarm, 'DB', CPU, { document });

    if (!alarm.input_list || alarm.input_list.length < 1) throw new SyntaxError("alarm的input_list必须有1项以上!"); // 空项不处理
    let list = alarm.input_list;
    for (let [index, input] of list.entries()) {
      // if input is symbol then convert to object of input type
      if (typeof input === 'string' || Array.isArray(input)) {
        input = { target: input };
        list[index] = input;
      }
      if (!input.name && !input.target) throw new SyntaxError('alarm的input项必须name和target有一个!');
      if (input.name === "test") throw new SyntaxError('alarm input项不能起名"test"! 已有同名内置项。');
      input.comment ??= '';
      if (Array.isArray(input.target)) input.target[3] ??= input.comment;
      if (input.target) make_prop_symbolic(input, 'target', CPU, { document, default_type: 'BOOL' });
    }
    list.push({ name: 'test', comment: '测试' });

    alarm.reset_list ??= [];
    list = alarm.reset_list;
    for (let [index, reset] of list.entries()) {
      // if reset is symbol then convert to object of input type
      if (typeof reset === 'string') {
        reset = { target: reset };
        list[index] = reset;
      }
      if (!reset.target) throw new SyntaxError('alarm的reset项必须有target!');
      if (reset.name === "reset") throw new SyntaxError('alarm reset 项不能起名"reset"! 已有同名内置项。');
      make_prop_symbolic(reset, 'target', CPU, { document, default_type: 'BOOL' });
    }
    list.push({ name: 'reset', comment: '输出复位' });

    make_prop_symbolic(alarm, "output", CPU, { document, default_type: 'BOOL' });
    alarm.output_list ??= [];
    list = alarm.output_list;
    for (let [index, output] of list.entries()) {
      if (typeof output !== 'string' && !Array.isArray(output)) throw new SyntaxError('alarm的output项必须必须是一个S7符号或SCL表达式!');
      make_prop_symbolic(list, index, CPU, { document, default_type: 'BOOL' });
    }
  });
}

function buile_input(list, DB_name) {
  const attributes = " {S7_m_c := 'true'}";
  for (let [index, item] of list.entries()) {
    item.assign_str = item.name && item.target
      ? `"${DB_name}".${item.name} := ${item.target.value};`
      : null;
    if (item.name) {// DB中生成S7_m_c字段，对input_list项，检测该字段上升沿
      item.declaration = `${item.name}${attributes} : BOOL ;`;
      item.edge = `"${DB_name}".${item.name}`;
    } else { // DB中只有follower字段，对input_list项，检测target上升沿
      item.name = `input_${index++}`;
      item.edge = item.target.value;
    }
  }
}

export function build_alarm({ list }) {
  list.forEach(alarm => { // 处理配置，形成完整数据
    buile_input(alarm.input_list, alarm.DB.name);
    buile_input(alarm.reset_list, alarm.DB.name);
    alarm.declaration = [...alarm.input_list, ...alarm.reset_list].filter(input => input.declaration);
    alarm.assign_list = [...alarm.input_list, ...alarm.reset_list].filter(input => input.assign_str);
  });
}

export function gen_alarm(alarm_list) {
  const rules = [];
  alarm_list.forEach(({ CPU, includes, loop_additional_code, list }) => {
    const { name, output_dir } = CPU;
    rules.push({
      "name": `${output_dir}/${ALARM_LOOP_NAME}.scl`,
      "tags": {
        name,
        includes,
        loop_additional_code,
        ALARM_LOOP_NAME,
        list,
      }
    })
  });
  return [{ rules, template }];
}

export function gen_alarm_copy_list(item) {
  return [];
}

import { make_prop_symbolic } from '../symbols.js';

export const platforms = ['step7', 'portal'];
export const LOOP_NAME = 'Interlock_Loop';

export function is_feature(name) {
  name = name.toLowerCase();
  return name === 'interlock' || name === 'IL' || name === 'alarm';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{document.gcl.file}}
// 摘要: {{document.gcl.MD5}}
{{includes}}
{{#for interlock in list}}
// {{interlock.comment}}
DATA_BLOCK "{{interlock.DB.name}}"{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'FALSE' }{{#else}}
{ S7_m_c := 'true' }{{#endif portal}}
AUTHOR:Goosy
FAMILY:GooLib
STRUCT
  enable {S7_m_c := 'true'} : BOOL := {{interlock.$enable}}; // 允许报警或连锁{{#for input in interlock.declaration}}
  {{input.declaration}} // {{input.comment}}{{#endfor input}}
  {{interlock.output.name}} {S7_m_c := 'true'} : BOOL ; // 联锁输出，由输入信号上升沿OR运算而来{{#for input in interlock.input_list}}
  {{input.name}}_follower : BOOL ; // 用于检测上升沿的追随变量{{#endfor input}}
END_STRUCT;
BEGIN
END_DATA_BLOCK
{{#endfor interlock}}

FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }{{#endif portal}}
// 联锁保护主循环

VAR_TEMP
  reset : BOOL ; // 复位
  output : BOOL ; // 输出
END_VAR
{{#for interlock in list}}
// {{interlock.comment}}{{#for assign in interlock.assign_list}}
{{assign.assign_str}}{{#endfor assign}}
reset := NOT "{{interlock.DB.name}}".enable{{#for reset in interlock.reset_list}} OR {{reset.edge}}{{#endfor reset}};
IF reset THEN
  "{{interlock.DB.name}}".{{interlock.output.name}} := FALSE;  // 复位output
  "{{interlock.DB.name}}".reset := FALSE;  // 复位reset
  // 复位联锁输出{{#for output in interlock.output_list}} 
  {{output.value}} := FALSE;{{#endfor output}}
ELSE
  output := {{#for no, input in interlock.input_list}}{{#if no}}
    OR {{#endif}}{{input.edge}} AND NOT "{{interlock.DB.name}}".{{input.name}}_follower{{#endfor}};
  IF output THEN
    "{{interlock.DB.name}}".{{interlock.output.name}} := TRUE; // 置位output
    // 置位联锁输出{{#for output in interlock.output_list}} 
    {{output.value}} := TRUE;{{#endfor output}}
  END_IF;
END_IF;
// 输入边沿维护{{#for input in interlock.input_list}}
"{{interlock.DB.name}}".{{input.name}}_follower := {{input.edge}};{{#endfor}}
{{#endfor interlock}}
END_FUNCTION
`

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols({ CPU, list }) {
  const document = CPU.interlock;
  list.forEach(interlock => {
    if (!interlock.DB) throw new SyntaxError("interlock转换必须有DB块!");
    let comment = interlock.comment ?? '报警联锁';
    interlock.$enable = interlock.$enable !== false ? true : false;
    make_prop_symbolic(interlock, 'DB', CPU, { document, default: { comment } });

    if (!interlock.input_list || interlock.input_list.length < 1) throw new SyntaxError("interlock的input_list必须有1项以上!"); // 不能为空项
    let list = interlock.input_list;
    for (let [index, input] of list.entries()) {
      // if input is symbol then convert to object of input type
      if (typeof input === 'string' || Array.isArray(input)) {
        input = { target: input };
        list[index] = input;
      }
      if (!input.name && !input.target) throw new SyntaxError('interlock的input项必须name和target有一个!');
      if (input.name === "test") throw new SyntaxError('interlock input项不能起名"test"! 已有同名内置项。');
      comment = input.comment ?? '';
      if (input.target) make_prop_symbolic(input, 'target', CPU, { document, default: { type: 'BOOL', comment } });
    }
    list.push({ name: 'test', comment: '测试' });

    interlock.reset_list ??= [];
    list = interlock.reset_list;
    for (let [index, reset] of list.entries()) {
      // if reset is symbol then convert to object of reset type
      if (typeof reset === 'string') {
        reset = { target: reset };
        list[index] = reset;
      }
      if (!reset.target) throw new SyntaxError('interlock的reset项必须有target!');
      if (reset.name === "reset") throw new SyntaxError('interlock reset 项不能起名"reset"! 已有同名内置项。');
      make_prop_symbolic(reset, 'target', CPU, { document, force: { type: 'BOOL' } });
    }
    list.push({ name: 'reset', comment: '输出复位' });

    interlock.output ??= { name: 'output' };
    // if output is string then convert to object of output type
    if (typeof interlock.output === 'string') {
      interlock.output = { name: interlock.output };
    }
    if (!interlock.output.name) throw new SyntaxError("interlock.output 配置必须有name属性!");
    interlock.output_list ??= [];
    list = interlock.output_list;
    for (let [index, output] of list.entries()) {
      if (typeof output !== 'string' && !Array.isArray(output)) throw new SyntaxError('interlock的output项必须必须是一个S7符号或SCL表达式!');
      make_prop_symbolic(list, index, CPU, { document, force: { type: 'BOOL' } });
    }
  });
}

function build_input(list, DB_name) {
  const S7_m_c = "{S7_m_c := 'true'}";
  for (let [index, item] of list.entries()) {
    item.assign_str = item.name && item.target
      ? `"${DB_name}".${item.name} := ${item.target.value};`
      : null;
    if (item.name) {// DB中生成S7_m_c字段，对input_list项，检测该字段上升沿
      item.declaration = `${item.name} ${S7_m_c} : BOOL ;`;
      item.edge = `"${DB_name}".${item.name}`;
    } else { // DB中只有follower字段，对input_list项，检测target上升沿
      item.name = `input_${index++}`;
      item.edge = item.target.value;
    }
    item.comment ??= '';
  }
}

export function build({ list }) {
  list.forEach(interlock => { // 处理配置，形成完整数据
    build_input(interlock.input_list, interlock.DB.name);
    build_input(interlock.reset_list, interlock.DB.name);
    interlock.declaration = [...interlock.input_list, ...interlock.reset_list].filter(input => input.declaration);
    interlock.assign_list = [...interlock.input_list, ...interlock.reset_list].filter(input => input.assign_str);
  });
}

export function gen(interlock_list) {
  const rules = [];
  interlock_list.forEach(({ CPU, includes, loop_additional_code, list }) => {
    const { output_dir, platform } = CPU;
    const document = CPU.interlock;
    rules.push({
      "name": `${output_dir}/${LOOP_NAME}.scl`,
      "tags": {
        platform,
        includes,
        loop_additional_code,
        LOOP_NAME,
        list,
        document,
      }
    })
  });
  return [{ rules, template }];
}

export function gen_copy_list(item) {
  return [];
}

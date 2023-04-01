import { make_s7express } from '../symbols.js';
import { BOOL, STRING, ensure_typed_value, nullable_typed_value } from '../value.js';
import { isString } from '../gcl.js';
import { isMap, isSeq } from 'yaml';

export const platforms = ['step7', 'portal'];
export const LOOP_NAME = 'Interlock_Loop';

export function is_feature(name) {
  name = name.toLowerCase();
  return name === 'interlock' || name === 'IL' || name === 'alarm';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
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
export function initialize_list(area) {
  const document = area.document;
  area.list = area.list.map(node => {
    const interlock = {
      node,
      comment: new STRING(node.get('comment') ?? '报警联锁')
    };
    const DB = node.get('DB');
    if (!DB) throw new SyntaxError("interlock转换必须有DB块!");
    const comment = interlock.comment.value;
    make_s7express(interlock, 'DB', DB, document, { default: { comment } });

    interlock.$enable = ensure_typed_value(BOOL, node.get('$enable') ?? true);

    const input_list = node.get('input_list');
    if (!input_list || !isSeq(input_list) || input_list.items.length < 1) {
      throw new SyntaxError("interlock的input_list必须有1项以上!"); // 不能为空项
    }
    interlock.input_list = input_list.items.map(item => {
      // if input is symbol then convert to interlock_item
      if (isString(item)) item = item.value;
      if (typeof item === 'string' || isSeq(item)) {
        const input = {};
        make_s7express(input, 'target', item, document, {
          s7express: true,
          force: { type: 'BOOL' }
        });
        return input;
      }
      if (!isMap(item)) throw new SyntaxError('interlock的input项输入错误!');
      const name = nullable_typed_value(STRING, item.get('name'));
      const target = item.get('target');
      if (!name && !target) throw new SyntaxError('interlock的input项的 name 和 target 属性必须有一个!');
      if (name?.value === "test") throw new SyntaxError('interlock input 项 name 属性不能起名"test"!');
      const input = { name, comment: new STRING(item.get('comment') ?? '') };
      const comment = input.comment.value;
      make_s7express(input, 'target', target, document, {
        s7express: true,
        default: { comment },
        force: { type: 'BOOL' }
      });
      return input;
    });
    interlock.input_list.push({ name: 'test', comment: '测试' });

    const reset_list = node.get('reset_list');
    if (reset_list && !isSeq(reset_list)) throw new SyntaxError('interlock的 reset_list 项输入错误!');
    interlock.reset_list = (reset_list?.items ?? []).map(item => {
      // if reset is symbol then convert to interlock_item
      if (isString(item)) item = item.value;
      if (typeof item === 'string' || isSeq(item)) {
        const reset = {};
        make_s7express(reset, 'target', item, document, {
          s7express: true,
          force: { type: 'BOOL' }
        });
        return reset;
      }
      if (!isMap(item)) throw new SyntaxError('interlock的reset项输入错误!');
      const target = item.get('target');
      if (!target) throw new SyntaxError('interlock的reset项必须有target!');
      const name = nullable_typed_value(STRING, item.get('name'));
      if (name?.value === "reset") throw new SyntaxError('interlock reset 项 name 属性不能起名"reset"!');
      const comment = new STRING(item.get('comment') ?? '').value;
      const reset = { name, comment };
      make_s7express(reset, 'target', target, document, {
        s7express: true,
        default: { comment },
        force: { type: 'BOOL' }
      });
      return reset;
    });
    interlock.reset_list.push({ name: 'reset', comment: '输出复位' });

    const output = node.get('output') ?? 'output';
    if (isString(output) || typeof output === 'string') {
      const name = new STRING(output);
      // if output is string then convert to object of output type
      interlock.output = { name };
    } else {
      if (!isMap(output)) throw new SyntaxError("interlock.output 配置有误!");
      const name = new STRING(output.get('name'));
      if (!name) throw new SyntaxError("interlock.output 配置必须有name属性!");
      const comment = new STRING(output.get('comment') || '').value;
      interlock.output = { name, comment };
    }

    const output_list = node.get('output_list');
    if (output_list && !isSeq(output_list)) throw new SyntaxError('interlock的 output_list 项输入错误!');
    const olist = interlock.output_list = [];
    if (output_list) output_list.items.forEach((item, index) => {
      if (!isString(item) && !isSeq(item)) throw new SyntaxError('interlock的output项必须必须是一个S7符号或SCL表达式!');
      make_s7express(olist, index, item, document, {
        s7express: true,
        force: { type: 'BOOL' }
      });
    });
    return interlock;
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

export function build_list({ list }) {
  list.forEach(interlock => { // 处理配置，形成完整数据
    build_input(interlock.input_list, interlock.DB.name);
    build_input(interlock.reset_list, interlock.DB.name);
    interlock.declaration = [...interlock.input_list, ...interlock.reset_list].filter(input => input.declaration);
    interlock.assign_list = [...interlock.input_list, ...interlock.reset_list].filter(input => input.assign_str);
  });
}

export function gen(interlock_list) {
  const rules = [];
  interlock_list.forEach(({ document, includes, loop_additional_code, list }) => {
    const { CPU, gcl } = document;
    const { output_dir, platform } = CPU;
    rules.push({
      "name": `${output_dir}/${LOOP_NAME}.scl`,
      "tags": {
        platform,
        includes,
        loop_additional_code,
        LOOP_NAME,
        list,
        gcl,
      }
    })
  });
  return [{ rules, template }];
}

export function gen_copy_list() {
  return [];
}

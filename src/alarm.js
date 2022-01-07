import { make_prop_symbolic, ALARM_LOOP_NAME } from './symbols.js';

export const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{#for alarm in list}}
// {{alarm.comment}}
DATA_BLOCK "{{alarm.DB.name}}"
{S7_m_c := 'true'}
STRUCT{{#for input in alarm.input_list}}
  {{input.name}}{{input.prop_str}} : BOOL ; // {{input.comment}}{{#endfor input}}
  output {S7_m_c := 'true'} : BOOL ; // 输入信号上升沿输出
  reset {S7_m_c := 'true'} : BOOL ; // 重置输出{{#for input in alarm.input_list}}
  {{input.name}}_follower : BOOL ; // 用于检测上升沿的追随变量{{#endfor input}}
END_STRUCT;
BEGIN
END_DATA_BLOCK
{{#endfor alarm}}

FUNCTION "alarm_Loop" : VOID
// 联锁保护主循环
VAR_TEMP
  output : BOOL ; // 输出
END_VAR
{{#for alarm in list}}{{#for input in alarm.input_list}}
"{{alarm.DB.name}}".{{input.name}} := {{input.target.value}};{{#endfor input}}
IF NOT "{{alarm.DB.name}}".reset{{#for input in alarm.input_list}}
  OR "{{alarm.DB.name}}".{{input.name}} AND NOT "{{alarm.DB.name}}".{{input.name}}_follower{{
  #endfor}} THEN
  "{{alarm.DB.name}}".output := TRUE;
ELSIF "{{alarm.DB.name}}".reset THEN
  "{{alarm.DB.name}}".output := FALSE;
  "{{alarm.DB.name}}".reset := FALSE;
END_IF;{{#for input in alarm.input_list}}
"{{alarm.DB.name}}".{{input.name}}_follower := "{{alarm.DB.name}}".{{input.name}};{{#endfor}}
// {{alarm.comment}}
output := "{{alarm.DB.name}}".output;{{#for output in alarm.output_list}}
{{output.target.value}} := output;{{#endfor output}}
{{#endfor alarm}}
END_FUNCTION
`

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} alarm_area
 * @returns {void}
 */
export function parse_symbols_alarm(alarm_area) {
  const symbols_dict = alarm_area.CPU.symbols_dict;
  alarm_area.list.forEach(alarm => {
    if (!alarm.DB) return; // 空块不处理
    make_prop_symbolic(alarm, 'DB', symbols_dict);
    for (let [index, input] of alarm.input_list.entries()) {
      if (typeof input === 'string') {
        input = { target: input };
        alarm.input_list[index] = input;
      }
      input.comment ??= '';
      if (input.name != null) {
        input.S7_m_c ??= true;
      } else {
        input.S7_m_c ??= false;
        input.name = `input_${index++}`;
      }
      make_prop_symbolic(input, 'target', symbols_dict, 'BOOL');
    }
    alarm.output_list ??= [];
    for (let [index, output] of alarm.output_list.entries()) {
      if (typeof output === 'string') {
        output = { target: output };
        alarm.output_list[index] = output;
      }
      output.comment ??= '';
      make_prop_symbolic(output, 'target', symbols_dict, 'BOOL');
    }
  });
}

export function build_alarm({ list }) {
  list.forEach(alarm => { // 处理配置，形成完整数据
    const {
      input_list,
    } = alarm;
    for (const input of input_list) {
      input.prop_str = input.S7_m_c ? ` {S7_m_c := 'true'}` : '';
    }
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
  return { rules, template };
}

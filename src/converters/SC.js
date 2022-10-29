/**
 * 串行处理
 * 依照3阶段提供3个函数， get_symbols_CP build_CP gen_CP
 * @file SC
 */

import { fixed_hex, context } from '../util.js';
import { make_prop_symbolic } from '../symbols.js';
import { posix } from 'path';
import assert from 'assert/strict';

export const CP340_NAME = 'CP340_Poll';
export const CP341_NAME = 'CP341_Poll';
export const LOOP_NAME = 'SC_Loop';
export const CRC = 'CRC16';
export const POLLS_NAME = 'SC_polls_DB';
export const BUILDIN = `
- [${CP340_NAME}, FB340, ${CP340_NAME}, CP340 SC communicate main process]
- [${CP341_NAME}, FB341, ${CP341_NAME}, CP341 SC communicate main process]
- [${CRC}, FC464, ${CRC}, modbus CRC16 check]
- [${LOOP_NAME}, FC341, ${LOOP_NAME}, main SC cyclic call function]
- [${POLLS_NAME}, DB880, ${POLLS_NAME}, SC polls data]
`;
export function is_type(type) {
  return type.toUpperCase() === 'MB' || type.toUpperCase() === 'SC';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}

// 轮询DB块，含485发送数据，
DATA_BLOCK "{{POLLS_NAME}}"
STRUCT{{#for module in modules}}
  {{module.polls_name}} : STRUCT //{{module.comment}} 轮询命令数据{{#for no, poll in module.polls}}
    poll{{no}} : STRUCT
      device_ID : BYTE;    //{{#if poll.deivce_ID}}子站地址
      MFunction : BYTE;    //modbus 功能号
      address : WORD;    //起始地址
      data : WORD;    //数据，对 01 02 03 04 功能码来说为长度，对 05 06 功能码来说为写入值
      CRC : WORD;    //检验字{{#else}}常量0
      send_length : BYTE;    //发送字节数
      send_data : ARRAY  [0 .. {{poll.send_data.length - 1}}] OF BYTE;    //发送数据{{#endif}}
      recvDB : INT;    //接收DB块号
      recvDBB : INT;    //接收DB起始地址CRC
    END_STRUCT;{{#endfor poll}}
  END_STRUCT;{{#endfor module}}
END_STRUCT;
BEGIN{{#for module in modules}}
  // --- {{module.comment}} 轮询数据{{#for no, poll in module.polls}}
  {{#if poll.deivce_ID}}
  {{module.polls_name}}.poll{{no}}.device_ID := B#16#{{poll.deivce_ID}}; // {{poll.comment}}
  {{module.polls_name}}.poll{{no}}.MFunction := B#16#{{poll.function}};
  {{module.polls_name}}.poll{{no}}.address := W#16#{{poll.address}};
  {{module.polls_name}}.poll{{no}}.data := W#16#{{poll.data}};{{#else}}
  {{module.polls_name}}.poll{{no}}.device_ID := B#16#0;    // 非modbus
  {{module.polls_name}}.poll{{no}}.send_length := B#16#{{poll.send_length}};    //发送字节数{{#for index, databyte in poll.send_data}}
  {{module.polls_name}}.poll{{no}}.send_data[{{index}}] := B#16#{{databyte}};    //发送数据{{index}}{{#endfor}}{{#endif}}
  {{module.polls_name}}.poll{{no}}.recvDB := {{poll.recv_DB.block_no}};
  {{module.polls_name}}.poll{{no}}.recvDBB := {{poll.recv_start}};{{#endfor poll}}
{{#endfor module}}
END_DATA_BLOCK

// 主调用
FUNCTION "{{LOOP_NAME}}" : VOID
{{#for no, module in modules}}
// {{no+1}}. {{module.type}} {{module.comment}}
"{{#if module.type == 'CP341'}}{{CP341_NAME}}{{#else}}{{CP340_NAME}}{{#endif}}"."{{module.DB.name}}"({{#if module.customTrigger}}
  customTrigger := TRUE,
  REQ           := {{module.REQ}},{{#endif}}
  Laddr         := {{module.module_addr.block_no}},  // CP模块地址
  DATA          := "{{POLLS_NAME}}".{{module.polls_name}});

{{#endfor module}}// 接收块
{{modules.recv_code}}
{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

/**
 * @typedef {object} S7Item
 * @property {Object} CPU
 * @property {Array} list
 * @property {Object} Options
 * @property {Array|string} includes
 */

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} SC_area
 * @returns {void}
 */
export function parse_symbols({ CPU, list, options }) {
  const document = CPU.SC;
  let index = 0;
  list.forEach(module => {
    assert(module?.DB, SyntaxError(`${CPU.name}:SC:module(${module.module_addr ?? module.comment}) 没有正确定义背景块!`));
    module.type ??= 'CP341';
    let type = 'notype';
    if (module.type === 'CP341') {
      options.has_CP341 = true;
      type = CP341_NAME;
    } else if (module.type === 'CP340') {
      options.has_CP340 = true;
      type = CP340_NAME;
    }
    assert(type !== 'notype', new SyntaxError(`${CPU.name}:SC:module${module.module_addr} 的类型 "${module.type}" 不支持`));
    module.module_addr = [`${module.type}_${++index}_addr`, 'IW' + module.module_addr];
    make_prop_symbolic(module, 'module_addr', CPU, { document, default_type: 'WORD' });
    if (Array.isArray(module.DB)) module.DB[3] ??= module.comment;
    make_prop_symbolic(module, 'DB', CPU, { document, default_type: type });
    module.polls.forEach(poll => {
      if (Array.isArray(poll.recv_DB)) poll.recv_DB[3] ??= poll.comment;
      make_prop_symbolic(poll, 'recv_DB', CPU, { document });
    });
  })
}

/**
 * 第二遍扫描 建立数据并查错
 * @date 2021-12-07
 * @param {S7Item} SC
 * @returns {void}
 */
export function build(SC) {
  const { CPU, list } = SC;
  Object.defineProperty(list, 'recv_DBs', { value: new Set() });
  list.forEach(module => { // 处理配置，形成完整数据
    assert(!Array.isArray(module.module_addr), Error(`${CPU.name}:SC 的模块${module?.DB.name}未提供 module_addr 或提供错误!`));
    module.polls_name ??= "polls_" + CPU.poll_list.push_new();
    module.customTrigger ??= false;
    module.polls.forEach(poll => {
      if (poll.deivce_ID && !poll.send_data) {
        poll.deivce_ID = fixed_hex(poll.deivce_ID, 2);
        poll.function = fixed_hex(poll.function, 2);
        poll.address = fixed_hex(poll.address ?? poll.started_addr, 4);
        poll.data = fixed_hex(poll.data ?? poll.length, 4);
      } else if (!poll.deivce_ID && poll.send_data) {
        // send_data must be a space-separated hex string
        const send_data_error = new SyntaxError(`"send_data:${poll.send_data}" —— send_data 必须是一个由空格分隔的16进制字符串`);
        assert.equal(typeof poll.send_data, 'string', send_data_error);
        assert(/^[0-9a-f]{2}( +[0-9a-f]{2})+$/i.test(poll.send_data.trim()), send_data_error);
        const send_data = poll.send_data.trim().split(/ +/);
        poll.send_data = send_data.map(byte => fixed_hex(byte, 2));
        poll.send_length = fixed_hex(send_data.length, 2);
      } else { // poll configuration wrong!
        throw new SyntaxError(`poll.deivce_ID 和 poll.send_data 只能且必须有其中一个!\tdeivce_ID:${poll.deivce_ID}\tsend_data:${poll.send_data}`);
      }
      const DB = poll.recv_DB;
      DB.needInvoke = DB.type_name == 'FB' && !poll?.dynamic;
      list.recv_DBs.add(DB);
    });
  });
  Object.defineProperty(list, 'recv_code', {
    value: [...list.recv_DBs].map(DB => {
      const comment = DB.comment ? ` // ${DB.comment}` : '';
      return DB.needInvoke ? `"${DB.type}"."${DB.name}"();${comment}` : `// ${DB.name}${comment}`;
    }).join('\n')
  });
}

export function gen(SC_list) {
  const rules = [];
  SC_list.forEach(({ CPU, includes, loop_additional_code, list: modules, options }) => {
    const { name, output_dir } = CPU;
    const { output_file = LOOP_NAME } = options;
    rules.push({
      "name": `${output_dir}/${output_file}.scl`,
      "tags": {
        name,
        modules,
        includes,
        loop_additional_code,
        CP340_NAME,
        CP341_NAME,
        LOOP_NAME,
        POLLS_NAME,
      }
    })
  });
  return [{ rules, template }];
}

export function gen_copy_list(item) {
  const copy_list = [];
  function push_copy_pair(filename) {
    const src = posix.join(context.module_path, 'CP_Poll', filename);
    const dst = posix.join(context.work_path, item.CPU.output_dir, filename);
    copy_list.push({ src, dst });
  }
  if (item.options.has_CP340) push_copy_pair(`${CP340_NAME}.scl`);
  if (item.options.has_CP341) push_copy_pair(`${CP341_NAME}.scl`);
  push_copy_pair(`${CRC}.awl`);
  return copy_list;
}

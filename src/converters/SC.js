/**
 * 串行处理
 * 依照3阶段提供3个函数， get_symbols_CP build_CP gen_CP
 * @file SC
 */

import { fixed_hex, context } from '../util.js';
import { make_prop_symbolic } from '../symbols.js';
import { posix } from 'path';
import assert from 'assert/strict';

export const platforms = ['step7'];
export const CP340_NAME = 'CP340_Poll';
export const CP341_NAME = 'CP341_Poll';
export const LOOP_NAME = 'SC_Loop';
export const CRC = 'CRC16';
export const POLLS_NAME = 'SC_polls_DB';

export function is_feature(feature) {
  return feature.toUpperCase() === 'MB' || feature.toUpperCase() === 'SC';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{document.gcl.file}}
// 摘要: {{document.gcl.MD5}}
{{includes}}

// 轮询DB块，含485调度指令和发送数据
DATA_BLOCK "{{POLLS_NAME}}"
STRUCT{{#for module in modules}}
  {{module.polls_name}} : STRUCT //{{module.comment}} 轮询命令数据{{#for poll in module.polls}}
    poll_{{poll.index}} : STRUCT
      next: BOOL; // false为结尾，否则有下一个
      enable: BOOL := TRUE; // 允许本poll通讯
      modbusFlag : BOOL; // 是否为modbus协议
      status: WORD;    // 预留
      sendDB : INT; // 发送DB，为0时为本块
      sendDBB : INT; // 发送DB起始地址
      sendLength : INT; // 发送长度
      recvDB : INT; // 接收DB
      recvDBB : INT; // 接收DB起始地址
      waitCount : INT; // 发送等待次数
    END_STRUCT;{{#endfor poll}}
  END_STRUCT;{{#endfor module}}{{#for module in modules}}{{#for poll in module.polls}}{{#if !poll.extra_send_DB}}
  poll_{{poll.index}}_data : STRUCT{{#if poll.send_data}}{{#
    ----通用发送}}
    send_data : ARRAY  [0 .. {{poll.send_data.length-1}}] OF BYTE;    //发送数据{{#else
    ----modbus 发送}}
    device_ID : BYTE;    //子站地址
    MFunction : BYTE;    //modbus 功能号
    address : WORD;    //起始地址
    data : WORD;    //数据，对 01 02 03 04 功能码来说为长度，对 05 06 功能码来说为写入值
    CRC : WORD;    //检验字{{#endif
    ----poll_data 结束}}
  END_STRUCT;{{#endif extra_send_DB}}{{#endfor poll}}{{#endfor module}}
END_STRUCT;
BEGIN{{#for module in modules}}
  // --- {{module.comment}} 轮询数据
  {{#for no,poll in module.polls}}
  // poll {{poll.index}}  {{poll.comment}}
  {{module.polls_name}}.poll_{{poll.index}}.next := {{no + 1 == module.polls.length ? 'FALSE' : 'TRUE'}};
  {{module.polls_name}}.poll_{{poll.index}}.modbusFlag := {{poll.is_modbus ? 'TRUE' : 'FALSE'}};
  {{module.polls_name}}.poll_{{poll.index}}.sendDB := {{poll.send_DB.block_no}};
  {{module.polls_name}}.poll_{{poll.index}}.sendDBB := {{poll.send_start}};
  {{module.polls_name}}.poll_{{poll.index}}.sendLength := {{poll.send_length}};
  {{module.polls_name}}.poll_{{poll.index}}.recvDB := {{poll.recv_DB.block_no}};
  {{module.polls_name}}.poll_{{poll.index}}.recvDBB := {{poll.recv_start}};{{#if !poll.extra_send_DB}}
  {{#----poll_send_data 开始}}// send data{{#if poll.send_data}}{{#for index, databyte in poll.send_data}}
  poll_{{poll.index}}_data.send_data[{{index}}] := B#16#{{databyte}};    //发送数据{{index}}{{#endfor}}{{#else}}
  poll_{{poll.index}}_data.device_ID := B#16#{{poll.deivce_ID}};
  poll_{{poll.index}}_data.MFunction := B#16#{{poll.function}};
  poll_{{poll.index}}_data.address := W#16#{{poll.address}};
  poll_{{poll.index}}_data.data := W#16#{{poll.data}};{{#endif}}{{#endif
  ----poll_send_data 结束}}
  {{#endfor poll}}
{{#endfor module}}END_DATA_BLOCK

// 主调用
FUNCTION "{{LOOP_NAME}}" : VOID
{{#for no, module in modules}}
// {{no+1}}. {{module.model}} {{module.comment}}
"{{#if module.model == 'CP341'}}{{CP341_NAME}}{{#else}}{{CP340_NAME}}{{#endif}}"."{{module.DB.name}}"({{#if module.customREQ}}
  customTrigger := TRUE,
  REQ           := {{module.customREQ.value}},{{#endif}}
  Laddr         := {{module.module.block_no}},  // CP模块地址
  DATA          := "{{POLLS_NAME}}".{{module.polls_name}});
{{#endfor module}}
// 发送接收块
{{invoke_code}}
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
    ++index;
    assert(module?.DB, new SyntaxError(`${CPU.name}:SC 第${index}个module(${module.comment}) 没有正确定义背景块!`));
    module.model ??= 'CP341';
    let model = 'nomodel';
    if (module.model === 'CP341') {
      options.has_CP341 = true;
      model = CP341_NAME;
    } else if (module.model === 'CP340') {
      options.has_CP340 = true;
      model = CP340_NAME;
    }
    assert(model !== 'nomodel', new SyntaxError(`${CPU.name}:SC:module${module.module_addr} 的类型 "${module.model}" 不支持`));
    assert(module.module || module.module_addr, new SyntaxError(`${CPU.name}:SC:module(${module.comment}) 未提供 module 或 module_addr!`));
    module.module ??= [ 
      `CP${index}_addr`,
      `IW${module.module_addr}`,
      'WORD',
      'HW module address'
    ];
    module.module[3] ??= 'HW module address';
    make_prop_symbolic(module, 'module', CPU);
    make_prop_symbolic(module, 'DB', CPU, { document, force: { type: model }, default: { comment: module.comment } });
    make_prop_symbolic(module, 'customREQ', CPU, { document, force: { type: 'BOOL' }});
    module.polls.forEach(poll => {
      make_prop_symbolic(poll, 'recv_DB', CPU, { document, default: { comment: poll.comment } });
      poll.extra_send_DB = !!poll.send_DB;
      poll.send_DB ??= POLLS_NAME;
      make_prop_symbolic(poll, 'send_DB', CPU, { document });
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
  const DBs = new Set(); // 去重
  const polls = list.map(module => module.polls).flat();
  polls.forEach((poll, index) => poll.index = index);
  let sendDBB = polls.length * 16;
  list.forEach(module => { // 处理配置，形成完整数据
    assert.equal(typeof module.module?.block_no, 'number', new SyntaxError(`${CPU.name}:SC:module(${module.comment}) 模块地址有误!`));
    module.polls_name ??= "polls_" + CPU.poll_list.push_new();
    module.polls.forEach(poll => {
      poll.is_modbus = !poll.send_data;
      assert(
        poll.extra_send_DB && poll.send_start && poll.send_length || !poll.extra_send_DB,
        new SyntaxError(`指定发送块 send_DB:${module.polls_name}/poll_${poll.index} 时，必须同时设置 send_start 和 send_length`)
      );
      if (poll.deivce_ID && poll.is_modbus) {
        poll.deivce_ID = fixed_hex(poll.deivce_ID, 2);
        poll.function = fixed_hex(poll.function, 2);
        poll.address = fixed_hex(poll.address ?? poll.started_addr, 4);
        poll.data = fixed_hex(poll.data ?? poll.length, 4);
        poll.send_length = 8;
      } else if (poll.send_data) {
        // send_data must be a space-separated hex string
        const send_data_error = new SyntaxError(`"send_data:${poll.send_data}" —— send_data 必须是一个由空格分隔的16进制字符串`);
        assert.equal(typeof poll.send_data, 'string', send_data_error);
        assert(/^[0-9a-f]{2}( +[0-9a-f]{2})+$/i.test(poll.send_data.trim()), send_data_error);
        const send_data = poll.send_data.trim().split(/ +/);
        poll.send_data = send_data.map(byte => fixed_hex(byte, 2));
        poll.send_length = send_data.length;
      } else if (!poll.extra_send_DB) { // poll configuration wrong!
        throw new SyntaxError(`发送数据在轮询DB中时，poll.deivce_ID 和 poll.send_data 必须有其中一个!\ndeivce_ID:${poll.deivce_ID}\tsend_data:${poll.send_data}`);
      }
      if (!poll.extra_send_DB) {
        poll.send_start = sendDBB;
        sendDBB += poll.send_length + poll.send_length % 2;
      }
      poll.uninvoke ??= false;
      [poll.send_DB, poll.recv_DB].forEach(DB => {
        DB.uninvoke ??= DB.type_name !== 'FB' || poll.uninvoke;
      });
      DBs.add(poll.send_DB).add(poll.recv_DB);
    });
  });
  SC.invoke_code = [...DBs].map(DB => {
    const comment = DB.comment ? ` // ${DB.comment}` : '';
    return DB.uninvoke ? `// "${DB.name}" ${DB.comment ?? ''}` : `"${DB.type}"."${DB.name}"();${comment}`;
  }).join('\n');
}

export function gen(SC_list) {
  const rules = [];
  SC_list.forEach(({ CPU, includes, loop_additional_code, invoke_code, list: modules, options }) => {
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME } = options;
    const document = CPU.SC;
    rules.push({
      "name": `${output_dir}/${output_file}.scl`,
      "tags": {
        modules,
        includes,
        loop_additional_code,
        invoke_code,
        CP340_NAME,
        CP341_NAME,
        LOOP_NAME,
        POLLS_NAME,
        document,
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

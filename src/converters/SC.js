/**
 * 串行处理
 * 依照3阶段提供3个函数， get_symbols_CP build_CP gen_CP
 * @file SC
 */

import { context } from '../util.js';
import { BOOL, STRING, fixed_hex, ensure_typed_value, ensure_PINT, nullable_typed_value, nullable_PINT } from '../value.js';
import { make_s7express } from '../symbols.js';
import { posix } from 'path';
import { isSeq } from 'yaml';
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
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}

// 轮询DB块，含485调度指令和发送数据
DATA_BLOCK "{{POLLS_NAME}}"
STRUCT{{#for module in modules}}
  {{module.name}} : STRUCT //{{module.comment}} 轮询命令数据{{#for poll in module.polls}}
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
  {{module.name}}.poll_{{poll.index}}.next := {{no + 1 == module.polls.length ? 'FALSE' : 'TRUE'}};
  {{module.name}}.poll_{{poll.index}}.modbusFlag := {{poll.is_modbus ? 'TRUE' : 'FALSE'}};
  {{module.name}}.poll_{{poll.index}}.sendDB := {{poll.send_DB.block_no}};
  {{module.name}}.poll_{{poll.index}}.sendDBB := {{poll.send_start}};
  {{module.name}}.poll_{{poll.index}}.sendLength := {{poll.send_length}};
  {{module.name}}.poll_{{poll.index}}.recvDB := {{poll.recv_DB.block_no}};
  {{module.name}}.poll_{{poll.index}}.recvDBB := {{poll.recv_start}};{{#if !poll.extra_send_DB}}
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
  DATA          := "{{POLLS_NAME}}".{{module.name}});
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
export function initialize_list(area) {
  const document = area.document;
  const CPU = document.CPU;
  const options = area.options;
  area.list = area.list.map((node, index) => {
    const module = {
      node,
      name: nullable_typed_value(STRING, node.get('name') ?? node.get('polls_name')),
      comment: new STRING(node.get('comment') ?? ''),
      model: ensure_typed_value(STRING, node.get('model') ?? 'CP341'),
    };

    const comment = module.comment.value;

    const type = (model => {
      if (model === 'CP341') {
        options.has_CP341 = true;
        return CP341_NAME;
      }
      if (model === 'CP340') {
        options.has_CP340 = true;
        return CP340_NAME;
      }
      throw new SyntaxError(`${CPU.name}:SC:module${comment} 的类型 "${module.model}" 不支持`);
    })(module.model.value);

    const module_symbol = node.get('module');
    const module_addr = nullable_PINT(node.get('module_addr'));
    assert(module_symbol || module_addr, new SyntaxError(`${CPU.name}:SC:module(${comment}) 未提供 module 或 module_addr!`));
    make_s7express(
      module,
      'module',
      module_symbol ?? [`CP${index + 1}_addr`, `IW${module_addr.value}`],
      document,
      { link: true, force: { type: 'WORD' }, default: { comment: 'HW module address' } }
    );

    const DB = node.get('DB');
    assert(DB, new SyntaxError(`${CPU.name}:SC 第${index + 1}个 module 没有正确定义背景块!`));
    make_s7express(module, 'DB', DB, document, { force: { type }, default: { comment } });

    const customREQ = node.get('customREQ');
    if (customREQ) make_s7express(module, 'customREQ', customREQ, document, {
      s7express: true,
      force: { type: 'BOOL' },
    });

    const polls = node.get('polls');
    assert(isSeq(polls), SyntaxError(`配置项"polls"必须为数组且个数大于0!`));
    module.polls = polls.items.map(item => {
      const poll = {
        comment: ensure_typed_value(STRING, item.get('comment') ?? ''),
        send_data: nullable_typed_value(STRING, item.get('send_data')),
        recv_start: ensure_PINT(item.get('recv_start')),
        uninvoke: ensure_typed_value(BOOL, item.get('uninvoke') ?? false),
      }
      poll.is_modbus = !poll.send_data;
      const comment = poll.comment.value;
      const recv_DB = item.get('recv_DB');
      make_s7express(poll, 'recv_DB', recv_DB, document, { default: { comment } });
      const send_DB = item.get('send_DB');
      poll.extra_send_DB = !!send_DB;
      make_s7express(poll, 'send_DB', send_DB ?? POLLS_NAME, document);

      if (poll.extra_send_DB) {
        // 有外部发送块时，必须有 send_start 和 send_length
        poll.send_start = ensure_PINT(item.get('send_start'));
        poll.send_length = ensure_PINT(item.get('send_length'));
      } else if (!poll.send_data) {
        // 无外部发送块但有send_data时，必须有 deivce_ID、function、started_addr 和 data
        poll.deivce_ID = ensure_PINT(item.get('deivce_ID'));
        poll.function = ensure_PINT(item.get('function'));
        poll.started_addr = nullable_PINT(item.get('started_addr')) ?? ensure_PINT(item.get('address'));
        // TODO:上一句出错的正确信息应当是 new SyntaxError(`配置项 address 或 started_addr 必须有一个!`)
        poll.data = nullable_PINT(item.get('data')) ?? ensure_PINT(item.get('length'));
        // TODO:上一句出错的正确信息应当是 new SyntaxError(`配置项 data 或 length 必须有一个!`)
      }
      return poll;
    });
    return module;
  })
}

/**
 * 第二遍扫描 建立数据并查错
 * @date 2021-12-07
 * @param {S7Item} SC
 * @returns {void}
 */
export function build_list(SC) {
  const CPU = SC.document.CPU;
  const DBs = new Set(); // 去重
  const list = SC.list;
  const polls = list.map(module => module.polls).flat();
  polls.forEach((poll, index) => poll.index = index);
  let sendDBB = polls.length * 16;
  list.forEach(module => { // 处理配置，形成完整数据
    assert.equal(typeof module.module?.block_no, 'number', new SyntaxError(`${CPU.name}:SC:module(${module.comment}) 模块地址有误!`));
    module.name ??= "polls_" + module.module.block_no;
    module.polls.forEach(poll => {
      if (poll.extra_send_DB) assert(
        poll.send_start && poll.send_length,
        new SyntaxError(`指定发送块 send_DB:${module.name}/poll_${poll.index} 时，必须同时设置 send_start 和 send_length`)
      );
      if (poll.send_data) {
        const send_data = poll.send_data.value.trim();
        // send_data must be a space-separated hex string
        const send_data_error = new SyntaxError(`"send_data:${send_data}" —— send_data 必须是一个由空格分隔的16进制字符串`);
        assert(/^[0-9a-f]{2}( +[0-9a-f]{2})+$/i.test(send_data), send_data_error);
        const data_stream = send_data.split(/ +/);
        poll.send_data = data_stream.map(byte => fixed_hex(byte, 2));
        poll.send_length = data_stream.length;
      } else if (poll.deivce_ID && poll.is_modbus) {
        poll.deivce_ID = fixed_hex(poll.deivce_ID, 2);
        poll.function = fixed_hex(poll.function, 2);
        poll.address = fixed_hex(poll.address ?? poll.started_addr, 4);
        poll.data = fixed_hex(poll.data ?? poll.length, 4);
        poll.send_length = 8;
      } else if (!poll.extra_send_DB) { // poll configuration wrong!
        throw new SyntaxError(`发送数据在轮询DB中时，poll.deivce_ID 和 poll.send_data 必须有其中一个!\ndeivce_ID:${poll.deivce_ID}\tsend_data:${poll.send_data}`);
      }
      if (!poll.extra_send_DB) {
        poll.send_start = sendDBB;
        sendDBB += poll.send_length + poll.send_length % 2;
      }
      [poll.send_DB, poll.recv_DB].forEach(DB => {
        // 用 ??= 确保共用块只遵循第一次的设置
        DB.uninvoke ??= DB.type_name !== 'FB' || poll.uninvoke.value;
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
  SC_list.forEach(({ document, includes, loop_additional_code, invoke_code, list: modules, options }) => {
    const { CPU, gcl } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME } = options;
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
        gcl,
      }
    })
  });
  return [{ rules, template }];
}

export function gen_copy_list(item) {
  const copy_list = [];
  function push_copy_pair(filename) {
    const src = posix.join(context.module_path, 'CP_Poll', filename);
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, filename);
    copy_list.push({ src, dst });
  }
  if (item.options.has_CP340) push_copy_pair(`${CP340_NAME}.scl`);
  if (item.options.has_CP341) push_copy_pair(`${CP341_NAME}.scl`);
  push_copy_pair(`${CRC}.awl`);
  return copy_list;
}

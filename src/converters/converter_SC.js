/**
 * 串行处理
 * 依照3阶段提供3个函数， get_symbols_CP build_CP gen_CP
 * @file SC
 */

import { context, fixed_hex } from '../util.js';
import { BOOL, STRING, PINT, ensure_value, nullable_value } from '../s7data.js';
import { make_s7_expression } from '../symbols.js';
import { posix } from 'path';
import { isSeq } from 'yaml';
import assert from 'assert/strict';

export const platforms = ['step7']; // platforms supported by this feature
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
{{if includes}}
{{  includes}}
{{endif}}_

// 轮询DB块，含485调度指令和发送数据
DATA_BLOCK "{{POLLS_NAME}}"
STRUCT
{{for module in modules}}_
    {{module.name}} : STRUCT //{{module.comment}} 轮询命令数据
{{  for poll in module.polls}}_
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
        END_STRUCT;
{{  endfor // poll}}_
    END_STRUCT;
{{endfor // module}}_
{{for module in modules}}_
{{for poll in module.polls}}_
{{if !poll.extra_send_DB}}_
    poll_{{poll.index}}_data : STRUCT
{{if poll.send_data // ----通用发送}}_
        send_data : ARRAY  [0 .. {{poll.send_data.length-1}}] OF BYTE;    //发送数据
{{else // ----modbus 发送}}_
        device_ID : BYTE;    //子站地址
        MFunction : BYTE;    //modbus 功能号
        address : WORD;    //起始地址
        data : WORD;    //数据，对 01 02 03 04 功能码来说为长度，对 05 06 功能码来说为写入值
        CRC : WORD;    //检验字
{{endif // 发送数据结束}}_
    END_STRUCT;
{{endif // extra_send_DB}}_
{{endfor // poll}}_
{{endfor // module}}_
END_STRUCT;
BEGIN
{{for module in modules}}
    // --- {{module.comment}} 轮询数据
{{for no,poll in module.polls}}
    // poll {{poll.index}}  {{poll.comment}}
    {{module.name}}.poll_{{poll.index}}.next := {{no + 1 == module.polls.length ? 'FALSE' : 'TRUE'}};
    {{module.name}}.poll_{{poll.index}}.modbusFlag := {{poll.is_modbus ? 'TRUE' : 'FALSE'}};
    {{module.name}}.poll_{{poll.index}}.sendDB := {{poll.send_DB.block_no}};
    {{module.name}}.poll_{{poll.index}}.sendDBB := {{poll.send_start}};
    {{module.name}}.poll_{{poll.index}}.sendLength := {{poll.send_length}};
    {{module.name}}.poll_{{poll.index}}.recvDB := {{poll.recv_DB.block_no}};
    {{module.name}}.poll_{{poll.index}}.recvDBB := {{poll.recv_start}};
{{if !poll.extra_send_DB //非外部数据块}}_
    // send data
{{  if poll.send_data}}_
{{      for index, databyte in poll.send_data}}_
    poll_{{poll.index}}_data.send_data[{{index}}] := B#16#{{databyte}};    //发送数据{{index}}
{{      endfor}}_
{{  else}}_
    poll_{{poll.index}}_data.device_ID := {{poll.deivce_ID.byteHEX}};
    poll_{{poll.index}}_data.MFunction := {{poll.function.byteHEX}};
    poll_{{poll.index}}_data.address := {{poll.started_addr.wordHEX}};
    poll_{{poll.index}}_data.data := {{poll.data.wordHEX}};
{{  endif // send_data}}_
{{endif // ----poll_send_data 结束}}_
{{endfor // poll}}_
{{endfor // module}}_
END_DATA_BLOCK

// 主调用
FUNCTION "{{LOOP_NAME}}" : VOID
{{if loop_begin}}_
{{  loop_begin}}
{{endif}}_
{{for no, module in modules}}
// {{no+1}}. {{module.model}} {{module.comment}}
"{{if module.model == 'CP341'}}{{CP341_NAME}}{{else}}{{CP340_NAME}}{{endif}}".{{module.DB.value}}(
{{if module.customREQ}}_
    customTrigger := TRUE,
    REQ           := {{module.customREQ.value}},
{{endif}}_
    Laddr         := {{module.module.block_no}},  // CP模块地址
    DATA          := "{{POLLS_NAME}}".{{module.name}});
{{endfor // module}}
// 发送接收块
{{invoke_code}}
{{if loop_end}}
{{  loop_end}}
{{endif}}_
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
            name: nullable_value(STRING, node.get('name') ?? node.get('polls_name')),
            comment: ensure_value(STRING, node.get('comment') ?? ''),
            model: ensure_value(STRING, node.get('model') ?? 'CP341'),
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

        let module_symbol = node.get('module');
        const module_addr = nullable_value(PINT, node.get('module_addr'));
        assert(module_symbol || module_addr, new SyntaxError(`${CPU.name}:SC:module(${comment}) 未提供 module 或 module_addr!`));
        module_symbol ??= [`CP${index + 1}_addr`, `IW${module_addr.value}`];
        make_s7_expression(
            module_symbol,
            {
                document,
                disallow_s7express: true,
                force: { type: 'WORD' },
                default: { comment: 'HW module address' },
            },
        ).then(
            symbol => module.module = symbol
        );

        const DB = node.get('DB');
        assert(DB, new SyntaxError(`${CPU.name}:SC 第${index + 1}个 module 没有正确定义背景块!`));
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type },
                default: { comment },
            },
        ).then(
            symbol => module.DB = symbol
        );

        const customREQ = node.get('customREQ');
        if (customREQ) make_s7_expression(
            customREQ,
            {
                document,
                force: { type: 'BOOL' },
                s7_expr_desc: `SC ${comment} customREQ`,
            },
        ).then(
            symbol => module.customREQ = symbol
        );

        const polls = node.get('polls');
        assert(isSeq(polls), SyntaxError(`配置项"polls"必须为数组且个数大于0!`));
        module.polls = polls.items.map(item => {
            const poll = {
                comment: ensure_value(STRING, item.get('comment') ?? ''),
                send_data: nullable_value(STRING, item.get('send_data')),
                recv_start: ensure_value(PINT, item.get('recv_start')),
                uninvoke: ensure_value(BOOL, item.get('uninvoke') ?? false),
            }
            poll.is_modbus = !poll.send_data;
            const comment = poll.comment.value;
            const recv_DB = item.get('recv_DB');
            make_s7_expression(
                recv_DB,
                {
                    document,
                    disallow_s7express: true,
                    default: { comment },
                },
            ).then(
                symbol => poll.recv_DB = symbol
            );
            const send_DB = item.get('send_DB');
            poll.extra_send_DB = !!send_DB;
            make_s7_expression(
                send_DB ?? POLLS_NAME,
                {
                    document,
                    disallow_s7express: true,
                    default: { comment },
                },
            ).then(
                symbol => poll.send_DB = symbol
            );

            if (poll.extra_send_DB) {
                // 有外部发送块时，必须有 send_start 和 send_length
                poll.send_start = ensure_value(PINT, item.get('send_start'));
                poll.send_length = ensure_value(PINT, item.get('send_length'));
            } else if (!poll.send_data) {
                // 无外部发送块但有send_data时，必须有 deivce_ID、function、started_addr 和 data
                poll.deivce_ID = ensure_value(PINT, item.get('deivce_ID'));
                poll.function = ensure_value(PINT, item.get('function'));
                poll.started_addr = nullable_value(PINT, item.get('started_addr')) ?? ensure_value(PINT, item.get('address'));
                // TODO:上一句出错的正确信息应当是 new SyntaxError(`配置项 address 或 started_addr 必须有一个!`)
                poll.data = nullable_value(PINT, item.get('data')) ?? ensure_value(PINT, item.get('length'));
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

export function gen({ document, includes, loop_begin, loop_end, invoke_code, list: modules, options }) {
    const { CPU, gcl } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME } = options;
    const rules = [{
        "name": `${output_dir}/${output_file}.scl`,
        "tags": {
            modules,
            includes,
            loop_begin,
            loop_end,
            invoke_code,
            CP340_NAME,
            CP341_NAME,
            LOOP_NAME,
            POLLS_NAME,
            gcl,
        }
    }];
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

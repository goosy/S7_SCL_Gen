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
export const SC_LOOP_NAME = 'SC_Loop';
export const SC_POLLS_NAME = 'SC_polls_DB';
export const SC_BUILDIN = `
- [${CP340_NAME}, FB340, ${CP340_NAME}, CP340 SC communicate main process]
- [${CP341_NAME}, FB341, ${CP341_NAME}, CP341 SC communicate main process]
- [${SC_LOOP_NAME}, FC341, ${SC_LOOP_NAME}, main SC cyclic call function]
- [${SC_POLLS_NAME}, DB880, ${SC_POLLS_NAME}, SC polls data]
`;
export function is_type_SC(type) {
    return type.toUpperCase() === 'MB' || type.toUpperCase() === 'SC';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}

// 轮询DB块，含485发送数据，
DATA_BLOCK "{{CP_POLLS_NAME}}"
STRUCT{{#for module in modules}}
    {{module.polls_name}} : STRUCT //{{module.comment}} 轮询命令数据{{#for no, poll in module.polls}}{{#if poll.deivce_ID}}
        device{{no}}_ID : BYTE;    //子站地址
        device{{no}}_function : BYTE;    //modbus 功能号
        device{{no}}_start : WORD;    //起始地址
        device{{no}}_length : WORD;    //长度
        device{{no}}_CRC : WORD;    //{{#else}}
        device{{no}}_ID : BYTE;    //常量0
        device{{no}}_send_length : BYTE;    //发送字节数
        device{{no}}_send_data : ARRAY  [0 .. {{poll.send_data.length - 1}}] OF BYTE;    //发送数据{{#endif}}
        device{{no}}_recvDB : INT;    //接收DB块号
        device{{no}}_recvDBB : INT;    //接收DB起始地址CRC{{#endfor}}
    END_STRUCT;{{#endfor module}}
END_STRUCT;
BEGIN{{#for module in modules}}
    // --- {{module.comment}} 轮询数据{{#for no, poll in module.polls}}
    {{#if poll.deivce_ID}}
    {{module.polls_name}}.device{{no}}_ID := B#16#{{poll.deivce_ID}}; // {{poll.comment}}
    {{module.polls_name}}.device{{no}}_function := B#16#{{poll.function}};
    {{module.polls_name}}.device{{no}}_start := W#16#{{poll.started_addr}};
    {{module.polls_name}}.device{{no}}_length := W#16#{{poll.length}};
    {{module.polls_name}}.device{{no}}_CRC := W#16#{{poll.CRC}}; {{#else}}
    {{module.polls_name}}.device{{no}}_ID := B#16#0;    // 非modbus
    {{module.polls_name}}.device{{no}}_send_length := B#16#{{poll.send_length}};    //发送字节数{{#for index, databyte in poll.send_data}}
    {{module.polls_name}}.device{{no}}_send_data[{{index}}] := B#16#{{databyte}};    //发送数据{{index}}{{#endfor}}{{#endif}}
    {{module.polls_name}}.device{{no}}_recvDB := {{poll.recv_DB.block_no}};
    {{module.polls_name}}.device{{no}}_recvDBB := {{poll.recv_start}};{{#endfor poll}}
{{#endfor module}}
END_DATA_BLOCK

// 主调用
FUNCTION "{{CP_LOOP_NAME}}" : VOID
{{#for no, module in modules}}
// {{no+1}}. {{module.type}} {{module.comment}}
"{{#if module.type == 'CP341'}}{{MB341_NAME}}{{#else}}{{MB340_NAME}}{{#endif}}"."{{module.DB.name}}"({{#if module.customTrigger}}
    customTrigger := TRUE,
    REQ           := {{module.REQ}},{{#endif}}
    Laddr         := {{module.module_addr.block_no}},  // CP模块地址
    DATA          := "{{CP_POLLS_NAME}}".{{module.polls_name}});
{{#for poll in module.polls}}{{poll.recv_code}}{{#endfor poll}}
{{#endfor module}}{{#if loop_additional_code}}
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
export function parse_symbols_SC({ CPU, list, options }) {
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
export function build_SC(SC) {
    const { CPU, list } = SC;
    list.forEach(module => { // 处理配置，形成完整数据
        assert(!Array.isArray(module.module_addr), Error(`${CPU.name}:SC 的模块${module?.DB.name}未提供 module_addr 或提供错误!`));
        module.polls_name ??= "polls_" + CPU.poll_list.push_new();
        module.customTrigger ??= false;
        module.polls.forEach(poll => {
            if (poll.deivce_ID && !poll.send_data) {
                // CRC must be a 4-character string
                const CRCError = new SyntaxError(`"CRC:${poll.CRC}" —— CRC 必须是一个包含4位16进制数的字符串，建议最中间加一空格防止YAML识别为10进制数字。`);
                assert.equal(typeof poll.CRC, 'string', CRCError);
                assert(/^[0-9a-f]{2} *[0-9a-f]{2}$/i.test(poll.CRC.trim()), CRCError); ''.replaceAll
                poll.CRC = poll.CRC.trim().replaceAll(' ', '');
                assert.equal(poll.CRC.length, 4, CRCError);
                poll.deivce_ID = fixed_hex(poll.deivce_ID, 2);
                poll.function = fixed_hex(poll.function, 2);
                poll.started_addr = fixed_hex(poll.started_addr, 4);
                poll.length = fixed_hex(poll.length, 4);
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
            poll.recv_code = poll.recv_DB.type_name == 'FB' ? `"${poll.recv_DB.type}"."${poll.recv_DB.name}"();\n` : '';
        });
    });
}

export function gen_SC(SC_list) {
    const rules = [];
    SC_list.forEach(({ CPU, includes, loop_additional_code, list: modules, options }) => {
        const { name, output_dir } = CPU;
        const { output_file = SC_LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                name,
                modules,
                includes,
                loop_additional_code,
                MB340_NAME: CP340_NAME,
                MB341_NAME: CP341_NAME,
                CP_LOOP_NAME: SC_LOOP_NAME,
                CP_POLLS_NAME: SC_POLLS_NAME,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_SC_copy_list(item) {
    const copy_list = [];
    if (item.options.has_CP340) {
        const filename = `${CP340_NAME}.scl`;
        const src = posix.join(context.module_path, 'CP_Poll', filename);
        const dst = posix.join(context.work_path, item.CPU.output_dir, filename);
        copy_list.push({ src, dst });
    }
    if (item.options.has_CP341) {
        const filename = `${CP341_NAME}.scl`;
        const src = posix.join(context.module_path, 'CP_Poll', filename);
        const dst = posix.join(context.work_path, item.CPU.output_dir, filename);
        copy_list.push({ src, dst });
    }
    return copy_list;
}

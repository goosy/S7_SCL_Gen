/**
 * 串行处理
 * 依照3阶段提供3个函数， get_symbols_CP build_CP gen_CP
 * @file SC
 */

import { fixed_hex } from "./util.js";
import { make_prop_symbolic, CP340_NAME, CP341_NAME, SC_LOOP_NAME, SC_POLLS_NAME } from './symbols.js';

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
export function parse_symbols_SC(SC_area) {
    const symbols_dict = SC_area.CPU.symbols_dict;
    const options = SC_area.options;
    let index = 0;
    SC_area.list.forEach(module => {
        if (!module?.DB) throw Error(`${SC_area.CPU.name}:SC:module(${module.module_addr ?? module.comment}) 没有正确定义背景块!`);
        module.type ??= 'CP341';
        let type = 'notype';
        if (module.type === 'CP341') {
            options.has_CP341 = true;
            type = CP341_NAME;
        } else if (module.type === 'CP340') {
            options.has_CP340 = true;
            type = CP340_NAME;
        }
        if (type === 'notype') throw new Error(`${SC_area.CPU.name}:SC:module${module.module_addr} 的类型 "${module.type}" 不支持`);
        module.module_addr = [`${module.type}_${++index}_addr`, 'IW' + module.module_addr];
        make_prop_symbolic(module, 'module_addr', symbols_dict, 'WORD');
        make_prop_symbolic(module, 'DB', symbols_dict, type);
        module.polls.forEach(poll => {
            make_prop_symbolic(poll, 'recv_DB', symbols_dict);
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
        if (Array.isArray(module.module_addr)) throw Error(`${CPU.name}:SC 的模块${module?.DB.name}未提供 module_addr 或提供错误!`);
        module.polls_name ??= "polls_" + CPU.poll_list.push_new();
        module.polls.forEach(poll => {
            if (poll.deivce_ID && !poll.send_data) {
                poll.deivce_ID = fixed_hex(poll.deivce_ID, 2);
                poll.function = fixed_hex(poll.function, 2);
                poll.started_addr = fixed_hex(poll.started_addr, 4);
                poll.length = fixed_hex(poll.length, 4);
            } else if (!poll.deivce_ID && poll.send_data) {
                const send_data = poll.send_data.trim().split(/ +/);
                poll.send_data = send_data.map(byte => fixed_hex(byte, 2));
                poll.send_length = fixed_hex(send_data.length, 2);
            } else { // poll.deivce_ID 和 poll.send_data 只能且必须有其中一个
                throw new Error(`poll configuration wrong!
                deivce_ID:${poll.deivce_ID}
                send_data:${poll.send_data}`);
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
    return { rules, template };
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
"{{#if module.type == 'CP341'}}{{MB341_NAME}}{{#else}}{{MB340_NAME}}{{#endif}}"."{{module.DB.name}}"({{#if module.coutomTrigger}}
    customTrigger := TRUE,
    REQ           := {{module.REQ}},{{#endif}}
    Laddr         := {{module.module_addr.block_no}},  // CP模块地址
    DATA          := "{{CP_POLLS_NAME}}".{{module.polls_name}});
{{#for poll in module.polls}}{{poll.recv_code}}{{#endfor poll}}
{{#endfor module}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

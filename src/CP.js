import { str_padding_left } from "./str_padding.js";
import { CP340_NAME, CP341_NAME, CP_LOOP_NAME, CP_POLLS_NAME } from './symbols.js';

function get_fixed_hex(num, length) {
    return str_padding_left(num.toString(16), length, '0').toUpperCase();
}

export function gen_CP_data(conf) {
    const { CPU, list } = conf;
    list.forEach(module => { // 处理配置，形成完整数据
        if (!module.DB) throw Error(`${CPU.name} modbus definition is wrong!`);
        module.Laddr = CPU.module_addr_list.push(module.Laddr);
        module.polls_name ??= "polls_" + CPU.poll_list.push_new();
        module.polls.forEach(poll => {
            if (poll.deivce_ID && !poll.send_data) {
                poll.deivce_ID = get_fixed_hex(poll.deivce_ID, 2);
                poll.function = get_fixed_hex(poll.function, 2);
                poll.started_addr = get_fixed_hex(poll.started_addr, 4);
                poll.length = get_fixed_hex(poll.length, 4);
            } else if (!poll.deivce_ID && poll.send_data) {
                const send_data = poll.send_data.trim().split(/ +/);
                poll.send_data = send_data.map(byte=>get_fixed_hex(byte, 2));
                poll.send_length = get_fixed_hex(send_data.length, 2);
            } else { // poll.deivce_ID 和 poll.send_data 只能且必须有其中一个
                throw new Error(`poll configuration wrong!
                deivce_ID:${poll.deivce_ID}
                send_data:${poll.send_data}`);
            }
            poll.recv_DB_code = `"${poll.recv_DB.type}"."${poll.recv_DB.name}"();`;
        });
    });
}

export function gen_MB(CP_confs) {
    const rules = [];
    CP_confs.forEach(({ CPU, list: modules, options }) => {
        const { name, output_dir } = CPU;
        const { output_file = CP_LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                name,
                modules,
                MB340_NAME: CP340_NAME,
                MB341_NAME: CP341_NAME,
                CP_LOOP_NAME,
                CP_POLLS_NAME,
            }
        })
    });
    return { rules, template };
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com

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
// 第{{no+1}}个模块：{{module.type}}
// {{module.comment}}
"{{#if module.type == 'CP341'}}{{MB341_NAME}}{{#else}}{{MB340_NAME}}{{#endif}}"."{{module.DB.name}}"({{#if module.coutomTrigger}}
    customTrigger := TRUE,
    REQ           := {{module.REQ}},{{#endif}}
    Laddr         := {{module.Laddr}},  // CP模块地址
    DATA          := "Poll_DB".{{module.polls_name}});
{{#endfor module}}
END_FUNCTION
`;

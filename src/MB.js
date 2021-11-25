import { str_padding_left } from "./str_padding.js";
export const MB340_name = 'MB_340_Poll';
export const MB341_name = 'MB_341_Poll';
export const MB_loop_name = 'MB_Loop';
export const MB_polls_name = 'MB_polls_DB';

function get_fixed_hex(num, length) {
    return str_padding_left(num.toString(16), length, '0').toUpperCase();
}

export function gen_MB_data(conf) {
    const { CPU, list } = conf;
    list.forEach(module => { // 处理配置，形成完整数据
        if (!module.DB) throw Error(`${CPU.name} modbus definition is wrong!`);
        module.Laddr = CPU.module_addr_list.push(module.Laddr);
        module.polls_name ??= "polls_" + CPU.poll_list.push_new();
        module.polls.forEach(poll => {
            poll.deivce_ID = get_fixed_hex(poll.deivce_ID, 2);
            poll.function = get_fixed_hex(poll.function, 2);
            poll.started_addr = get_fixed_hex(poll.started_addr, 4);
            poll.length = get_fixed_hex(poll.length, 4);
            poll.recv_DB_code = `"${poll.recv_DB.type}"."${poll.recv_DB.name}"();`;
        });
    });
}

export function gen_MB(MB_confs) {
    const rules = [];
    MB_confs.forEach(({ CPU, list: modules, options }) => {
        const { name, output_dir } = CPU;
        const { output_file = 'MB_Loop' } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                name,
                modules,
                MB340_name,
                MB341_name,
                MB_loop_name,
                MB_polls_name,
            }
        })
    });
    return {rules, template};
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com

// 轮询DB块，含modbus发送指令，
DATA_BLOCK "{{MB_polls_name}}"
STRUCT{{#for module in modules}}
    {{module.polls_name}}: ARRAY[0..{{module.polls.length - 1}}] OF STRUCT //{{module.comment}} 轮询命令数据
        DeviceID : BYTE;    //子站地址
        MFunction : BYTE;    //modbus 功能号
        StartAddress : WORD;    //起始地址
        Number : WORD;    //长度
        CRC : WORD;    //CRC
        recvDB : INT;    //接收DB块号
        recvDBB : INT;    //接收DB起始地址
    END_STRUCT;{{#endfor module}}
END_STRUCT;
BEGIN{{#for module in modules}}
    // --- {{module.comment}} 轮询数据{{#for no, poll in module.polls}}
    {{module.polls_name}}[{{no}}].DeviceID := B#16#{{poll.deivce_ID}}; // {{poll.comment}}
    {{module.polls_name}}[{{no}}].MFunction := B#16#{{poll.function}};
    {{module.polls_name}}[{{no}}].StartAddress := W#16#{{poll.started_addr}};
    {{module.polls_name}}[{{no}}].Number := W#16#{{poll.length}};
    {{module.polls_name}}[{{no}}].CRC := W#16#{{poll.CRC}};
    {{module.polls_name}}[{{no}}].recvDB := {{poll.recv_DB.block_no}};
    {{module.polls_name}}[{{no}}].recvDBB := {{poll.recv_start}};{{#endfor poll}}{{#endfor module}}
END_DATA_BLOCK

// 主调用
FUNCTION "{{MB_loop_name}}" : VOID
{{#for no, module in modules}}
// 第{{no+1}}个模块：{{module.type}}
// {{module.comment}}
"{{#if module.type == 'CP341'}}{{MB341_name}}{{#else}}{{MB340_name}}{{#endif}}"."{{module.DB.name}}"({{#if module.coutomTrigger}}
    customTrigger := TRUE,
    REQ           := {{module.REQ}},{{#endif}}
    Laddr         := {{module.Laddr}},  // CP模块地址
    DATA          := "Poll_DB".{{module.polls_name}});
{{#endfor module}}
END_FUNCTION
`;

import { MB_confs } from "./gen_data.js";

export const rules = [];
MB_confs.forEach(({ CPU, list: modules, options }) => {
    const { name, output_dir } = CPU;
    const { output_file = `MB_Loop`, MB340_FB, MB341_FB, MB_Loop, polls_db } = options;
    const mbfb340_name = MB340_FB?.name ?? 'MB_340_Poll';
    const mbfb341_name = MB341_FB?.name ?? 'MP_341_FB';
    const mbl_name = MB_Loop.name ?? 'MB_Loop';
    const pdb_name = polls_db?.name ?? 'Polls_DB';
    rules.push({
        "name": `${output_dir}/${output_file}.scl`,
        "tags": {
            name,
            modules,
            mbfb340_name,
            mbfb341_name,
            mbl_name,
            pdb_name,
        }
    })
});

export let template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com

// 轮询DB块，含modbus发送指令，
DATA_BLOCK "{{pdb_name}}"
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
FUNCTION "MB_Loop" : VOID
{{#for no, module in modules}}
// 第{{no+1}}个模块：{{module.type}}
// {{module.comment}}
"{{#if module.type == 'CP341'}}{{mbfb341_name}}{{#else}}{{mbfb340_name}}{{#endif}}"."{{module.DB.name}}"({{#if module.coutomTrigger}}
    customTrigger := TRUE,
    REQ           := {{module.REQ}},{{#endif}}
    Laddr         := {{module.Laddr}},  // CP模块地址
    DATA          := "Poll_DB".{{module.polls_name}});
{{#endfor module}}
END_FUNCTION
`;

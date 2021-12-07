import { IntIncHL, fixed_hex } from './util.js';
import { make_prop_symbolic, MT_NAME,MT_LOOP_NAME,MT_POLLS_NAME } from './symbols.js';
const TCON_deivce_id = {
  "IM151-8PN/DP": "B#16#01",
  "CPU31x-2PN/DP": "B#16#02",
  "CPU314C-2PN/DP": "B#16#02",
  "IM154-8PN/DP": "B#16#02",
  "CPU319-3PN/DP": "B#16#03",
  "CPU315T-3PN/DP": "B#16#03",
  "CPU317T-3PN/DP": "B#16#03",
  "CPU317TF-3PN/DP": "B#16#03",
  "CPU319-3PN/DP_X4": "B#16#04",
  "CPU317-2PN/DP_X4": "B#16#04",
  "CPU412-2PN": "B#16#05",
  "CPU414-3PN/DP": "B#16#05",
  "CPU416-3PN/DP": "B#16#05",
  "CPU412-5H_PN/DP_X5": "B#16#05",
  "CPU414-5H_PN/DP_X5": "B#16#05",
  "CPU416-5H_PN/DP_X5": "B#16#05",
  "CPU417-5H_PN/DP_X5": "B#16#05",
  "CPU410-5H_X8": "B#16#08",
  "CPU412-5H_PN/DP_X15": "B#16#15",
  "CPU414-5H_PN/DP_X15": "B#16#15",
  "CPU416-5H_PN/DP_X15": "B#16#15",
  "CPU417-5H_PN/DP_X15": "B#16#15",
  "CPU410-5H_X18": "B#16#18",
}
const DEFAULT_DEVICE_ID = "B#16#02"; //默认的设备号


/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} MT_area
 * @returns {void}
 */
export function parse_symbols_MT(MT_area) {
  const symbols_dict = MT_area.CPU.symbols_dict;
  const conn_list = MT_area.list;
  conn_list.forEach(conn => {
    make_prop_symbolic(conn, 'DB', symbols_dict, MT_NAME);
    conn.polls.forEach(poll => {
      make_prop_symbolic(poll, 'recv_DB', symbols_dict);
    })
  });
}

export function build_MT(conf) {
  const { CPU, list } = conf;
  list.forEach(conn => { // 处理配置，形成完整数据
    const {
      conn_ID_list,
      conn_host_list,
      poll_list
    } = CPU;

    const {
      ID,
      local_device_id = TCON_deivce_id[conn.local_device] ?? DEFAULT_DEVICE_ID, // 已是SCL字面量
      host,
      port,
      // interval_time, // 由SCL程序负责默认的间隔时长
    } = conn;

    conn.ID = fixed_hex(conn_ID_list.push(ID), 4);

    // port_list
    const host_str = conn.host.join('.');
    conn_host_list[host_str] ??= new IntIncHL(502);
    const port_list = conn_host_list[host_str];
    port_list.push(port);
    conn.DB.name ??= "conn_MT" + ID;
    conn.local_device_id = local_device_id;
    conn.IP1 = fixed_hex(host[0], 2);
    conn.IP2 = fixed_hex(host[1], 2);
    conn.IP3 = fixed_hex(host[2], 2);
    conn.IP4 = fixed_hex(host[3], 2);
    conn.port1 = fixed_hex((port >>> 8), 2);
    conn.port2 = fixed_hex((port & 0xff), 2);
    conn.polls_name ??= "polls_" + poll_list.push_new();
    conn.polls.forEach(poll => {
      poll.deivce_ID = fixed_hex(poll.deivce_ID, 2);
      poll.function = fixed_hex(poll.function, 2);
      poll.started_addr = fixed_hex(poll.started_addr, 4);
      poll.length = fixed_hex(poll.length, 4);
      poll.recv_DB_code = `"${poll.recv_DB.type}"."${poll.recv_DB.name}"();`;
    });
  });
}

export function gen_MT(MT_list) {
  const rules = [];
  MT_list.forEach(({ CPU, includes, list: connections, options }) => {
    const { name, output_dir } = CPU;
    const { output_file = 'MT_Loop' } = options;
    rules.push({
      "name": `${output_dir}/${output_file}.scl`,
      "tags": {
        name,
        includes,
        connections,
        MT_NAME,
        MT_LOOP_NAME,
        MT_POLLS_NAME,
      }
    })
  });
  return {rules, template};
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
{{#for conn in connections}}
DATA_BLOCK "{{conn.DB.name}}" "MT_Poll" // {{conn.comment}}
BEGIN
  TCON_Parameters.block_length := W#16#40;     //固定为64
  TCON_Parameters.id := W#16#{{conn.ID}};             //连接ID 每个连接必须不一样！
  TCON_Parameters.connection_type := B#16#11;  //连接类型 11H=TCP/IP native, 12H=ISO on TCP, 13H=UDP, 01=TCP/IP comp
  TCON_Parameters.active_est := TRUE;          //是否主动（本功能调用必须为TRUE）
  TCON_Parameters.local_device_id := {{conn.local_device_id}};  // {{conn.local_device}}
  TCON_Parameters.local_tsap_id_len := B#16#0;
  TCON_Parameters.rem_subnet_id_len := B#16#0;
  TCON_Parameters.rem_staddr_len := B#16#4;
  TCON_Parameters.rem_tsap_id_len := B#16#2;
  TCON_Parameters.next_staddr_len := B#16#0;
  TCON_Parameters.rem_staddr[1] := B#16#{{conn.IP1}};    //IP1 {{conn.host[0]}}
  TCON_Parameters.rem_staddr[2] := B#16#{{conn.IP2}};    //IP2 {{conn.host[1]}}
  TCON_Parameters.rem_staddr[3] := B#16#{{conn.IP3}};    //IP3 {{conn.host[2]}}
  TCON_Parameters.rem_staddr[4] := B#16#{{conn.IP4}};    //IP4 {{conn.host[3]}}
  TCON_Parameters.rem_tsap_id[1] := B#16#{{conn.port1}};   //PortH {{conn.port}}
  TCON_Parameters.rem_tsap_id[2] := B#16#{{conn.port2}};   //PortL
  TCON_Parameters.spare := W#16#0;
END_DATA_BLOCK
{{#endfor}}

// 轮询定义数据块 "{{MT_POLLS_NAME}}"
DATA_BLOCK "{{MT_POLLS_NAME}}"
TITLE = "轮询定义"
VERSION : 0.0
STRUCT{{#for conn in connections}}
  {{conn.polls_name}} : ARRAY  [0 .. {{conn.polls.length-1}}] OF STRUCT// 轮询列表 {{conn.comment}}
    MBAP_seq : WORD ; //事务号 PLC自动填写
    MBAP_protocol : WORD ;  //必须为0
    MBAP_length : WORD  := W#16#6;  //长度，对读命令，通常为6
    MBAP_Addr : BYTE ;  //设备号，不关心的情况下可以填0
    MFunction : BYTE ;  //modbus功能号
    Addr : WORD ; //起始地址
    Number : WORD ; //长度
    recvDB : INT ;  //接收数据块号
    recvDBB : INT ; //接收数据块起始地址
  END_STRUCT ;{{#endfor conn}}
  buff : STRUCT // 接收缓冲区
    MBAP_seq : WORD ;    //事务号 PLC自动填写
    MBAP_protocol : WORD ;    //必须为0
    MBAP_length : WORD ;    //长度，对读命令，通常为6
    MBAP_Addr : BYTE ;    //设备号，不关心的情况下可以填0
    MFunction : BYTE ;    //modbus功能号
    data : ARRAY[0..251] OF BYTE ;    //数据
  END_STRUCT ;
END_STRUCT ;
BEGIN{{#for conn in connections}}
  // --- {{conn.comment}}{{#for no, poll in conn.polls}}
  {{conn.polls_name}}[{{no}}].MBAP_Addr := B#16#{{poll.deivce_ID}}; // {{poll.comment}}
  {{conn.polls_name}}[{{no}}].MFunction := B#16#{{poll.function}};
  {{conn.polls_name}}[{{no}}].Addr := W#16#{{poll.started_addr}};
  {{conn.polls_name}}[{{no}}].Number := W#16#{{poll.length}};
  {{conn.polls_name}}[{{no}}].recvDB := {{poll.recv_DB.block_no}};
  {{conn.polls_name}}[{{no}}].recvDBB := {{poll.recv_start}};{{#endfor poll}}{{#endfor conn}}
END_DATA_BLOCK

// 调用
FUNCTION "{{MT_LOOP_NAME}}" : VOID
{{#for conn in connections}}
// {{conn.comment}}
"{{MT_NAME}}"."{{conn.DB.name}}" ( {{#if conn.interval_time}}
  intervalTime := {{conn.interval_time}},{{#endif}}
  DATA  := "{{MT_POLLS_NAME}}".{{conn.polls_name}},
  buff  := "{{MT_POLLS_NAME}}".buff);{{#for poll in conn.polls}}
{{poll.recv_DB_code}}{{#endfor poll}}
{{#endfor conn}}
END_FUNCTION
`;
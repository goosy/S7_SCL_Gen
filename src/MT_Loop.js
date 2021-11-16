import { configurations } from "./gen_data.js";
import { str_padding_left } from "./str_padding.js";

function get_fixed_hex(num, length) {
  return str_padding_left(num.toString(16), length, '0').toUpperCase();
}
export const rules = [];
configurations.forEach(({ name, connections, MB_TCP_Poll, MT_Loop, polls_DB, recv_DBs, output_dir }) => {
  const conns = connections.map(conn => ({
    name: conn.name,
    comment: conn.comment,
    ID: get_fixed_hex(conn.ID, 4),
    local_device: conn.local_device,
    local_device_id: conn.local_device_id, // 已是SCL字面量
    host: conn.host,
    IP1: get_fixed_hex(conn.host[0], 2),
    IP2: get_fixed_hex(conn.host[1], 2),
    IP3: get_fixed_hex(conn.host[2], 2),
    IP4: get_fixed_hex(conn.host[3], 2),
    port: conn.port,
    port1: get_fixed_hex((conn.port >>> 8), 2),
    port2: get_fixed_hex((conn.port & 0xff), 2),
    polls_name: conn.polls_name,
    polls: conn.polls.map(poll => ({
      deivce_ID: get_fixed_hex(poll.deivce_ID, 2),
      function: get_fixed_hex(poll.function, 2),
      addr: get_fixed_hex(poll.started_addr, 4),
      length: get_fixed_hex(poll.length, 4),
      recv_DB: poll.recv_DB.DB_NO, // SCL字面量为十进制
      recv_DBB: poll.recv_DB.start, // SCL字面量为十进制
      additional_code: poll.recv_DB.additional_code,
      comment: poll.comment,
    })),
  }));
  name = name ? name + '_' : '';
  rules.push({
    "name": `${name}MT_Loop.scl`,
    "tags": {
      conns,
      recv_DBs,
      MB_TCP_Poll,
      MT_Loop,
      polls_DB,
    }
  })
});

export let template = `{{#for conn in conns}}
DATA_BLOCK "{{conn.name}}" "{{MB_TCP_Poll.name}}" // {{conn.comment}}
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

// 轮询定义数据块 "{{polls_DB.name}}" DB{{polls_DB.DB_NO}}
DATA_BLOCK "{{polls_DB.name}}"
TITLE = "轮询定义"
VERSION : 0.0
STRUCT{{#for conn in conns}}
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
BEGIN{{#for conn in conns}}{{#for no, poll in conn.polls}}
  {{conn.polls_name}}[{{no}}].MBAP_Addr := B#16#{{poll.deivce_ID}}; // {{poll.comment}}
  {{conn.polls_name}}[{{no}}].MFunction := B#16#{{poll.function}};
  {{conn.polls_name}}[{{no}}].Addr := W#16#{{poll.addr}};
  {{conn.polls_name}}[{{no}}].Number := W#16#{{poll.length}};
  {{conn.polls_name}}[{{no}}].recvDB := {{poll.recv_DB}};
  {{conn.polls_name}}[{{no}}].recvDBB := {{poll.recv_DBB}};{{#endfor poll}}{{#endfor conn}}
END_DATA_BLOCK

// 调用
FUNCTION "{{MT_Loop.name}}" : VOID
{{#for conn in conns}}
"{{MB_TCP_Poll.name}}"."{{conn.name}}" ( // {{conn.comment}}{{#if conn.interval_time}}
  intervalTime := {{conn.interval_time}},{{#endif}}
  DATA  := "{{polls_DB.name}}".{{conn.polls_name}},
  buff  := "{{polls_DB.name}}".buff);{{#for poll in conn.polls}}
{{poll.additional_code}}{{#endfor poll}}
{{#endfor conn}}
END_FUNCTION
`;
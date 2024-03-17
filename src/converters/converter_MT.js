import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { isSeq } from 'yaml';
import { make_s7_expression } from '../symbols.js';
import {
    BOOL, PINT, STRING, TIME,
    nullable_value, ensure_value,
    IntHashList
} from '../s7data.js';
import { context, fixed_hex, elog } from '../util.js';

export const platforms = ['step7']; // platforms supported by this feature
export const NAME = 'MT_Poll';
export const LOOP_NAME = 'MT_Loop';
export const POLLS_NAME = 'MT_polls_DB';

const DEFAULT_DEVICE_ID = "B#16#02"; //默认的设备号
const device_id = { // 只需要填写设备型号
    "IM151-8_PN/DP": "B#16#01",
    "CPU31x-2_PN/DP": "B#16#02",
    "CPU314C-2_PN/DP": "B#16#02",
    "IM154-8_PN/DP": "B#16#02",
    "CPU315T-3_PN/DP": "B#16#03",
    "CPU317T-3_PN/DP": "B#16#03",
    "CPU317TF-3_PN/DP": "B#16#03",
    "CPU412-2_PN": "B#16#05",
    "CPU414-3_PN/DP": "B#16#05",
    "CPU416-3_PN/DP": "B#16#05",
}
const device_X_id = { // 可能需要填写槽号的
    //['', 'X2', 'X4']
    "CPU317-2_PN/DP": "B#16#02",
    "CPU317-2_PN/DP_X2": "B#16#02",
    "CPU317-2_PN/DP_X4": "B#16#04",
    //['', 'X3', 'X4']
    "CPU319-3_PN/DP": "B#16#03",
    "CPU319-3_PN/DP_X3": "B#16#03",
    "CPU319-3_PN/DP_X4": "B#16#04",
}
const device_R_X_id = { // 可能需要填写槽号和机架号的
    // ['', 'R0', 'R1'] × ['', 'X5']
    // 412-5H
    "CPU412-5H_PN/DP": "B#16#05",
    "CPU412-5H_PN/DP_X5": "B#16#05",
    "CPU412-5H_PN/DP_R0": "B#16#05",
    "CPU412-5H_PN/DP_R0_X5": "B#16#05",
    "CPU412-5H_PN/DP_R1": "B#16#15",
    "CPU412-5H_PN/DP_R1_X5": "B#16#15",
    // 414-5H
    "CPU414-5H_PN/DP": "B#16#05",
    "CPU414-5H_PN/DP_X5": "B#16#05",
    "CPU414-5H_PN/DP_R0": "B#16#05",
    "CPU414-5H_PN/DP_R0_X5": "B#16#05",
    "CPU414-5H_PN/DP_R1": "B#16#15",
    "CPU414-5H_PN/DP_R1_X5": "B#16#15",
    // 416-5H
    "CPU416-5H_PN/DP": "B#16#05",
    "CPU416-5H_PN/DP_X5": "B#16#05",
    "CPU416-5H_PN/DP_R0": "B#16#05",
    "CPU416-5H_PN/DP_R0_X5": "B#16#05",
    "CPU416-5H_PN/DP_R1": "B#16#15",
    "CPU416-5H_PN/DP_R1_X5": "B#16#15",
    // 417-5H
    "CPU417-5H_PN/DP": "B#16#05",
    "CPU417-5H_PN/DP_X5": "B#16#05",
    "CPU417-5H_PN/DP_R0": "B#16#05",
    "CPU417-5H_PN/DP_R0_X5": "B#16#05",
    "CPU417-5H_PN/DP_R1": "B#16#15",
    "CPU417-5H_PN/DP_R1_X5": "B#16#15",
    // 410-5H  ['', 'R0', 'R1'] × ['', 'X5', 'X8']
    "CPU410-5H": "B#16#05",
    "CPU410-5H_X5": "B#16#05",
    "CPU410-5H_X8": "B#16#08",
    "CPU410-5H_R0": "B#16#05",
    "CPU410-5H_R0_X5": "B#16#05",
    "CPU410-5H_R0_X8": "B#16#08",
    "CPU410-5H_R1": "B#16#15",
    "CPU410-5H_R1_X5": "B#16#15",
    "CPU410-5H_R1_X8": "B#16#18",
}

export function is_feature(feature) {
    return feature.toUpperCase() === 'MT' || feature.toLowerCase() === 'modbustcp';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{if includes}}
{{  includes}}
{{endif}}_
{{for conn in connections}}
DATA_BLOCK {{conn.DB.value}} "{{NAME}}" // {{conn.comment}}
BEGIN
    TCON_Parameters.block_length := W#16#40;     //固定为64
    TCON_Parameters.id := W#16#{{conn.ID}};             //连接ID 每个连接必须不一样！
    TCON_Parameters.connection_type := B#16#11;  //连接类型 11H=TCP/IP native, 12H=ISO on TCP, 13H=UDP, 01=TCP/IP comp
    TCON_Parameters.active_est := TRUE;          //是否主动（本功能调用必须为TRUE）
    TCON_Parameters.local_device_id := {{conn.local_device_id}};  //{{conn.device}} {{conn.R}} {{conn.X}}
    TCON_Parameters.local_tsap_id_len := B#16#0;
    TCON_Parameters.rem_subnet_id_len := B#16#0;
    TCON_Parameters.rem_staddr_len := B#16#4;
    TCON_Parameters.rem_tsap_id_len := B#16#2;
    TCON_Parameters.next_staddr_len := B#16#0;
    TCON_Parameters.rem_staddr[1] := B#16#{{conn.IP1}};    //IP1 {{conn.IP[0]}}
    TCON_Parameters.rem_staddr[2] := B#16#{{conn.IP2}};    //IP2 {{conn.IP[1]}}
    TCON_Parameters.rem_staddr[3] := B#16#{{conn.IP3}};    //IP3 {{conn.IP[2]}}
    TCON_Parameters.rem_staddr[4] := B#16#{{conn.IP4}};    //IP4 {{conn.IP[3]}}
    TCON_Parameters.rem_tsap_id[1] := B#16#{{conn.port1}};   //PortH {{conn.port}}
    TCON_Parameters.rem_tsap_id[2] := B#16#{{conn.port2}};   //PortL
    TCON_Parameters.spare := W#16#0;
END_DATA_BLOCK
{{endfor}}_

// 轮询定义数据块 "{{POLLS_NAME}}"
DATA_BLOCK "{{POLLS_NAME}}"
TITLE = "轮询定义"
VERSION : 0.0
STRUCT
{{for conn in connections}}_
    {{conn.name}} : ARRAY  [0 .. {{conn.polls.length-1}}] OF STRUCT// 轮询列表 {{conn.comment}}
        MBAP_seq : WORD ;               //事务号 PLC自动填写
        MBAP_protocol : WORD ;          //必须为0
        MBAP_length : WORD  := W#16#6;  //长度，对读命令，通常为6
        device_ID : BYTE ;              //设备号，不关心的情况下可以填0
        MFunction : BYTE ;              //modbus功能号
        address : WORD ;                //起始地址
        data : WORD ;                   //长度
        recvDB : INT ;                  //接收数据块号
        recvDBB : INT ;                 //接收数据块起始地址
    END_STRUCT ;
{{endfor // conn}}_
    buff : STRUCT // 接收缓冲区
        MBAP_seq : WORD ;               //事务号 PLC自动填写
        MBAP_protocol : WORD ;          //必须为0
        MBAP_length : WORD ;            //长度，对读命令，通常为6
        device_ID : BYTE ;              //设备号，不关心的情况下可以填0
        MFunction : BYTE ;              //modbus功能号
        data : ARRAY[0..251] OF BYTE ;  //数据
    END_STRUCT ;
END_STRUCT ;
BEGIN
{{for conn in connections}}_
    // --- {{conn.comment}}
{{  for no, poll in conn.polls}}_
    {{conn.name}}[{{no}}].device_ID := B#16#{{poll.deivce_ID}}; // {{poll.comment}}
    {{conn.name}}[{{no}}].MFunction := B#16#{{poll.function}};
    {{conn.name}}[{{no}}].address := W#16#{{poll.address}};
    {{conn.name}}[{{no}}].data := W#16#{{poll.data}};
    {{conn.name}}[{{no}}].recvDB := {{poll.recv_DB.block_no}};
    {{conn.name}}[{{no}}].recvDBB := {{poll.recv_start}};
{{  endfor // poll}}_
{{endfor // conn}}_
END_DATA_BLOCK

{{for conn in connections}}_
{{if conn.$interval_time != undefined}}_
DATA_BLOCK {{conn.DB.value}} "{{NAME}}"
BEGIN
        intervalTime := {{conn.$interval_time.DINT}};
END_DATA_BLOCK

{{endif // conn.$interval_time}}_
{{endfor // conn}}_
// 调用
FUNCTION "{{LOOP_NAME}}" : VOID
{{if loop_begin}}_
{{  loop_begin}}

{{endif}}_
{{for conn in connections}}_
// {{conn.comment}}
"{{NAME}}".{{conn.DB.value}} (
{{if conn.interval_time != undefined}}_
    intervalTime := {{conn.interval_time.value}},
{{endif}}_
    DATA  := "{{POLLS_NAME}}".{{conn.name}},
    buff  := "{{POLLS_NAME}}".buff);

{{endfor // conn}}_
// 接收块
{{invoke_code}}
{{if loop_end}}
{{  loop_end}}
{{endif}}_
END_FUNCTION
`;

function get_device_id(device, R, X) {
    let id = device_id[device];
    if (id) return id; // device is valid
    const device_paras = [device];
    if (R) {
        device_paras.push(R);
    }
    if (X) {
        id = device_X_id[`${device}_${X}`];
        if (id) return id; // device_X is valid
        device_paras.push(X);
    }
    id = device_R_X_id[device_paras.join('_')]
    if (id) return id; // device_R_X is valid
    return null; // 没有对应设备号
}

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    const CPU = document.CPU;
    // CPU.device 必须第二遍扫描才有效
    area.list = area.list.map(node => {
        const conn = {
            node,
            ID: nullable_value(PINT, node.get('ID')),
            name: nullable_value(STRING, node.get('name') ?? node.get('polls_name')),
            comment: new STRING(node.get('comment') ?? '')
        };
        const comment = conn.comment.value;
        const name = conn.name?.value;
        const DB = node.get('DB');
        assert(DB, new SyntaxError(
            `${CPU.name}:MT:conn(${name ?? conn.ID}) DB is not defined correctly! 没有正确定义DB!`
        ));
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(
            symbol => conn.DB = symbol
        );

        // host IP
        let host = node.get('host');
        host = isSeq(host) ? host.items.join('.') : ensure_value(STRING, host).value;
        assert(
            /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host),
            new SyntaxError(`配置项"host: ${host}"有误，必须提供IP地址，可以是数组形式!`)
        );
        conn.host = host;
        conn.port = nullable_value(PINT, node.get('port'));
        conn.IP = host.split('.').map(part => {
            const ip = ensure_value(PINT, part);
            assert(ip.value < 256, new SyntaxError(`配置项"host: ${host}"的IP地址越界!`));
            return ip;
        });
        const R = nullable_value(PINT, node.get('rack'));
        const X = nullable_value(PINT, node.get('XSlot'));
        conn.R = R ? 'R' + R : '';
        conn.X = X ? 'X' + X : '';
        conn.$interval_time = nullable_value(TIME, node.get('$interval_time'));
        const interval_time = node.get('interval_time');
        make_s7_expression(
            interval_time,
            {
                document,
                force: { type: 'DINT' },
                default: { comment: `interval time of ${comment}` },
                s7_expr_desc: `MT ${comment} conn.interval_time`,
            },
        ).then(
            symbol => conn.interval_time = symbol
        );

        const polls = node.get('polls');
        assert(isSeq(polls), SyntaxError(`配置项"polls"必须为数组且个数大于0!`));
        conn.polls = polls.items.map(item => {
            const poll = {
                comment: ensure_value(STRING, item.get('comment') ?? ''),
                deivce_ID: ensure_value(PINT, item.get('deivce_ID')),
                function: ensure_value(PINT, item.get('function')),
                started_addr: nullable_value(PINT, item.get('started_addr')) ?? ensure_value(PINT, item.get('address')),
                // TODO:上一句出错的正确信息应当是 new SyntaxError(`配置项 address 或 started_addr 必须有一个!`)
                data: nullable_value(PINT, item.get('data')) ?? ensure_value(PINT, item.get('length')),
                // TODO:上一句出错的正确信息应当是 new SyntaxError(`配置项 data 或 length 必须有一个!`)
                recv_start: ensure_value(PINT, item.get('recv_start')),
                uninvoke: nullable_value(BOOL, item.get('uninvoke')) ?? new BOOL(false),
            };
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
            return poll;
        })
        return conn;
    });
}

export function build_list(MT) {
    const { document, list } = MT
    const CPU = document.CPU;
    const DBs = new Set(); // 去重
    list.forEach(conn => { // 处理配置，形成完整数据
        const {
            conn_ID_list,
            conn_host_list,
        } = CPU;

        conn.device ??= CPU.device;
        const {
            ID,
            local_device_id = get_device_id(conn.device, conn.R, conn.X), // 已是SCL字面量
            host,
            // interval_time, // 由SCL程序负责默认的间隔时长
        } = conn;
        const port = conn.port.value;

        // 指定的device没有对应的通信设备号
        if (local_device_id === null && conn.device) elog(new SyntaxError(`指定的通信设备号"${conn.device} rack${conn.rack} xslot${conn.XSlot}"不存在！`));
        // 如没指定device，则采用默认设备号
        conn.local_device_id = local_device_id ?? DEFAULT_DEVICE_ID;

        // port_list
        conn_host_list[host] ??= new IntHashList(502); // 默认一个host从502端口开始
        const port_list = conn_host_list[host];
        port_list.push(port);

        conn.ID = fixed_hex(conn_ID_list.push(ID), 4);
        conn.DB.name ??= "conn_MT" + ID;
        conn.IP1 = fixed_hex(conn.IP[0], 2);
        conn.IP2 = fixed_hex(conn.IP[1], 2);
        conn.IP3 = fixed_hex(conn.IP[2], 2);
        conn.IP4 = fixed_hex(conn.IP[3], 2);
        conn.port1 = fixed_hex((port >>> 8), 2);
        conn.port2 = fixed_hex((port & 0xff), 2);
        conn.name ??= new STRING("polls_" + conn.ID);
        conn.polls.forEach(poll => {
            poll.deivce_ID = fixed_hex(poll.deivce_ID, 2);
            poll.function = fixed_hex(poll.function, 2);
            poll.address = fixed_hex(poll.address ?? poll.started_addr, 4);
            poll.data = fixed_hex(poll.data ?? poll.length, 4);
            // 用 ??= 确保共用块只遵循第一次的设置
            poll.recv_DB.uninvoke ??= poll.recv_DB.type_name !== 'FB' || poll.uninvoke.value;
            DBs.add(poll.recv_DB);
        });
    });
    MT.invoke_code = [...DBs].map(DB => {
        const comment = DB.comment ? ` // ${DB.comment}` : '';
        return DB.uninvoke ? `// "${DB.name}" ${DB.comment ?? ''}` : `"${DB.type}"."${DB.name}"();${comment}`;
    }).join('\n');
}

export function gen({ document, includes, loop_begin, loop_end, invoke_code, list: connections, options }) {
    const { CPU, gcl } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME } = options;
    const rules = [{
        "name": `${output_dir}/${output_file}.scl`,
        "tags": {
            includes,
            loop_begin,
            loop_end,
            invoke_code,
            connections,
            NAME,
            LOOP_NAME,
            POLLS_NAME,
            gcl,
        }
    }];
    return [{ rules, template }];
}

export function gen_copy_list(item) {
    const filename = `${NAME}.scl`;
    const src = {
        filename: posix.join(context.module_path, NAME, filename),
        encoding: 'utf8',
    };
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, filename);
    return [{ src, dst }];
}

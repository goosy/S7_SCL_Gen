// import { connections, addition } from '../conf/config.js';
import yaml from "js-yaml";
import { readdir, readFile } from 'fs/promises';
import { basename } from 'path';
import { str_padding_left } from "./str_padding.js";

function get_fixed_hex(num, length) {
    return str_padding_left(num.toString(16), length, '0').toUpperCase();
}

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

function push_num(list, num, default_start) {
    if (num) {
        // num 有值时
        // 不能非正数字
        if (typeof num !== 'number' || isNaN(num) || num < 0) throw new Error(`${num} 不是数字!`);
        // 不能重复
        if (list.includes(num)) throw new Error(`存在重复的 ${num}!`);
        num = parseInt(num);
        list.push(num);
    } else {
        // num 无值时自动取下一个有效的数字
        num = list.length > 0 ? list[list.length - 1] + 1 : default_start ?? 1;
        while (list.includes(num)) num++;
        list.push(num);
    }
    return num;
}

const FIRSTID = 1; // 默认的第一个连接ID
const FIRSTPORT = 502; //默认的第一个端口号
const FIRSTDBNO = 891; //默认的第一个连接块号
const DEFAULT_DEVICE_ID = "B#16#02"; //默认的设备号
function makeup_conn(conn, conf_paras) { // 处理配置，形成完整数据
    const { ID, DB_NO, port, interval_time = null } = conn;
    const { conn_ID_List, conn_DB_List, conn_remote_List, recv_DBs } = conf_paras;
    const host = conn.host.join('.');
    conn_remote_List[host] ??= [];
    const port_list = conn_remote_List[host];

    conn.ID = get_fixed_hex(push_num(conn_ID_List, ID, FIRSTID), 4);
    conn.name ??= "conn_MT" + conn.ID;
    conn.local_device_id ??= TCON_deivce_id[conn.local_device] ?? DEFAULT_DEVICE_ID; // 已是SCL字面量
    conn.DB_NO = push_num(conn_DB_List, DB_NO, FIRSTDBNO);
    conn.IP1 = get_fixed_hex(conn.host[0], 2);
    conn.IP2 = get_fixed_hex(conn.host[1], 2);
    conn.IP3 = get_fixed_hex(conn.host[2], 2);
    conn.IP4 = get_fixed_hex(conn.host[3], 2);
    conn.port = push_num(port_list, port, FIRSTPORT);
    conn.port1 = get_fixed_hex((conn.port >>> 8), 2);
    conn.port2 = get_fixed_hex((conn.port & 0xff), 2);
    conn.interval_time = interval_time; // 由SCL程序负责默认的间隔时长
    conn.polls_name ??= "polls_" + conf_paras.polls_index++;
    conn.polls.forEach(poll => {
        const db = poll.recv_DB;
        recv_DBs.push(db);
        poll.deivce_ID = get_fixed_hex(poll.deivce_ID, 2);
        poll.function = get_fixed_hex(poll.function, 2);
        poll.started_addr = get_fixed_hex(poll.started_addr, 4);
        poll.length = get_fixed_hex(poll.length, 4);
        poll.recv_DB = db.DB_NO; // SCL字面量为十进制
        poll.recv_DBB = db.start; // SCL字面量为十进制
        poll.additional_code = db.additional_code;
    });

}

export const configurations = [];
try {
    const path = new URL('../conf/', import.meta.url);
    for (const file of await readdir(path)) {
        const basefilename = basename(file, '.yml');
        const yaml_str = await readFile(new URL(file, path), { encoding: 'utf8' });
        const { name = basefilename, connections = [], options = {} } = yaml.load(yaml_str);
        options.path = path;
        const recv_DBs = [];
        configurations.push({ name, connections, recv_DBs, options });
    }
} catch (e) {
    console.log(e);
}
configurations.forEach(({ connections, recv_DBs, options }) => {
    const conf_paras = { // 当前配置的参数
        conn_ID_List: [], // 最终的ID列表
        conn_DB_List: [], // 最终的连接块列表
        conn_remote_List: {}, // 最终的连接地址列表
        polls_index: 0, // 当前查询计数
        recv_DBs, // 所有接收块
    };
    connections.forEach(conn => makeup_conn(conn, conf_paras));

    options.output_prefix ??= '';
    options.symbols ??= [];

    let name = options.MB_TCP_Poll.name ?? 'MB_TCP_Poll';
    let block_no = options.MB_TCP_Poll.block_no ?? 343;
    options.MB_TCP_Poll = {
        name,
        block_name: 'FB',
        block_no,
        type_name: 'FB',
        type_no: block_no,
        comment: 'modbus TCP poll main function block',
    }

    name = options.MT_Loop.name ?? 'MT_Loop';
    block_no = options.MT_Loop.block_no ?? 343;
    options.MT_Loop = {
        name,
        block_name: 'FC',
        block_no,
        type_name: 'FC',
        type_no: block_no,
        comment: 'modbus TCP call function',
    }

    name = options.polls_DB.name ?? 'polls_DB';
    block_no = options.polls_DB.block_no ?? 800;
    options.polls_DB = {
        name,
        block_name: 'DB',
        block_no,
        type_name: 'DB',
        type_no: block_no,
        comment: 'modbus TCP poll data',
    }

});

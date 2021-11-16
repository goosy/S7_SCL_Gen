// import { connections, addition } from '../conf/config.js';
import yaml from "js-yaml";
import { readdir, readFile } from 'fs/promises';
import { basename } from 'path';

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

    conn.ID = push_num(conn_ID_List, ID, FIRSTID);
    conn.name ??= "conn_MT" + conn.ID;
    conn.local_device_id ??= TCON_deivce_id[conn.local_device] ?? DEFAULT_DEVICE_ID;
    conn.DB_NO = push_num(conn_DB_List, DB_NO, FIRSTDBNO);
    conn.port = push_num(port_list, port, FIRSTPORT);
    conn.interval_time = interval_time; // 由SCL程序负责默认的间隔时长
    conn.polls_name ??= "polls_" + conf_paras.polls_index++;
    conn.polls.forEach(poll => {
        recv_DBs.push(poll.recv_DB);
    })
}

export const configurations = [];
const load_confs = [];
try {
    const conf_path = new URL('../conf/', import.meta.url);
    for (const file of await readdir(conf_path)) {
        const yaml_str = await readFile(new URL(file, conf_path), { encoding: 'utf8' });
        const conf = yaml.load(yaml_str);
        conf.file = basename(file, '.yml');
        load_confs.push(conf);
    }
} catch (e) {
    console.log(e);
}
load_confs.forEach(({ file, connections = [], options = {} }) => {
    const recv_DBs = [];
    const conf_paras = {
        conn_ID_List: [], // 当前配置最终的ID列表
        conn_DB_List: [], // 当前配置最终的连接块列表
        conn_remote_List: {}, // 当前配置最终的连接地址列表
        polls_index: 0, // 当前配置的当前查询计数
        recv_DBs, // 当前配置的所有接收块
    };
    connections.forEach(conn => makeup_conn(conn, conf_paras));

    const additional_symbol = options?.symbols ?? [];
    const output_dir = options.output_dir;

    const MB_TCP_Poll = {
        FB_NO: options?.MB_TCP_Poll?.FB_NO ?? 343,
        name: options?.MB_TCP_Poll?.name ?? 'MB_TCP_Poll',
    }
    const MT_Loop = {
        FC_NO: options?.MT_Loop?.FC_NO ?? 343,
        name: options?.MT_Loop?.name ?? 'MT_Loop',
    }
    const polls_DB = {
        DB_NO: options?.polls_DB?.DB_NO ?? 800,
        name: options?.polls_DB?.name ?? 'polls_DB',
    }
    const name = options?.name ?? file;
    configurations.push({ name, connections, MB_TCP_Poll, MT_Loop, polls_DB, recv_DBs, additional_symbol, output_dir });
});

import { str_padding_left } from "./str_padding.js";
import { IncreaseHashTable } from './increase_hash_table.js';

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
const DEFAULT_DEVICE_ID = "B#16#02"; //默认的设备号

export function gen_MT_data(conf) {
    const { CPU, symbols, connections } = conf;
    connections.forEach(conn => { // 处理配置，形成完整数据
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

        conn.ID = get_fixed_hex(conn_ID_list.push(ID), 4);

        // port_list
        const host_str = conn.host.join('.');
        conn_host_list[host_str] ??= new IncreaseHashTable(502);
        const port_list = conn_host_list[host_str];
        port_list.push(port);
        conn.name ??= "conn_MT" + ID;
        conn.local_device_id = local_device_id;
        conn.IP1 = get_fixed_hex(host[0], 2);
        conn.IP2 = get_fixed_hex(host[1], 2);
        conn.IP3 = get_fixed_hex(host[2], 2);
        conn.IP4 = get_fixed_hex(host[3], 2);
        conn.port1 = get_fixed_hex((port >>> 8), 2);
        conn.port2 = get_fixed_hex((port & 0xff), 2);
        conn.polls_name ??= "polls_" + poll_list.push_new();
        conn.polls.forEach(poll => {
            const db_symbol = symbols[poll.recv_DB];
            poll.deivce_ID = get_fixed_hex(poll.deivce_ID, 2);
            poll.function = get_fixed_hex(poll.function, 2);
            poll.started_addr = get_fixed_hex(poll.started_addr, 4);
            poll.length = get_fixed_hex(poll.length, 4);
            poll.recv_DBNO = db_symbol.block_no; // SCL字面量为十进制
            poll.recv_DB_code = `"${db_symbol.type}"."${db_symbol.name}"();`;
        });
    });
}
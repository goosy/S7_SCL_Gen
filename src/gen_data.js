import { MT_connections, addition } from '../conf/config.js';

const conn_ID_List = []; // 最终的ID列表
const conn_DB_List = []; // 最终的连接块列表
const conn_remote_List = {}; // 最终的连接地址列表

const FIRSTID = 1,
    FIRSTDBNO = 891,
    FIRSTPORT = 502;

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

let poll_index = 0;
const recv_DBs = [];
function makeup_conn(conn) { // 处理配置，形成完整数据
    const { ID, DB_NO, port, interval_time = null } = conn;
    const host = conn.host.join('.');
    conn_remote_List[host] ??= [];
    const port_list = conn_remote_List[host];

    conn.ID = push_num(conn_ID_List, ID, FIRSTID);
    conn.name ??= "conn_MT" + conn.ID;
    conn.local_device_id ??= 2;
    conn.DB_NO = push_num(conn_DB_List, DB_NO, FIRSTDBNO);
    conn.port = push_num(port_list, port, FIRSTPORT);
    conn.interval_time = interval_time;
    conn.poll_name ??= "poll_" + poll_index++;
    conn.polls.forEach(poll => {
        recv_DBs.push(poll.recv_DB);
    })
}

MT_connections.forEach(makeup_conn);

const MB_TCP_Poll = {
    FB_NO: addition?.MB_TCP_Poll?.FB_NO ?? 343,
    name: addition?.MB_TCP_Poll?.name ?? 'MB_TCP_Poll',
}
const MT_Loop = {
    FC_NO: addition?.MT_Loop?.FC_NO ?? 343,
    name: addition?.MT_Loop?.name ?? 'MT_Loop',
}
const Poll_DB = {
    DB_NO: addition?.Poll_DB?.DB_NO ?? 800,
    name: addition?.Poll_DB?.name ?? 'Poll_DB',
}

const additional_code = addition?.code ?? '';
const additional_symbol = addition?.symbols ?? [];

export {
    MT_connections,
    MB_TCP_Poll,
    MT_Loop,
    Poll_DB,
    recv_DBs,
    additional_code,
    additional_symbol
}

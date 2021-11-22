import { str_padding_left } from "./str_padding.js";

function get_fixed_hex(num, length) {
    return str_padding_left(num.toString(16), length, '0').toUpperCase();
}

export function gen_MB_data(conf) {
    const { CPU, list } = conf;
    list.forEach(module => { // 处理配置，形成完整数据
        if(!module.DB) throw Error(`${CPU.name} modbus definition is wrong!`);
        module.Laddr = CPU.module_addr_list.push(module.Laddr);
        module.DB.name ??= "conn_MB" + ID;
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
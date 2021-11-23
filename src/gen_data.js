import { dump, loadAll } from "js-yaml";
import { readdir, readFile, writeFile } from 'fs/promises';
import { gen_MT_data } from './gen_MT_data.js';
import { gen_MB_data } from './gen_MB_data.js';
import { rebuild_symbols, add_symbol, add_symbols } from './symbols.js';
import { IncreaseHashTable } from './increase_hash_table.js';

export const AI_confs = []; // 模拟量配置
export const valve_confs = []; // 阀门配置
export const MT_confs = []; // modbus TCP 配置
export const MB_confs = []; // modbus RTU 配置
export const CPUs = {}; // CPU 配置
const confs = { // 全局维护表
    exist_dict: {}, // 保存列表
    confs_map: {}, // 配置列表
    exist(CPU, type) {
        return !!confs.exist_dict[CPU + type];
    },
    set(CPU, type, conf) {
        confs.exist_dict[CPU + type] = true;
        confs.confs_map[CPU] ??= [];
        confs.confs_map[CPU].push(conf);
    },
    get(CPU) {
        return confs.confs_map[CPU];
    },
    get_all() {
        return Object.entries(confs.confs_map);
    }
};

function to_ref(item) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        return { value: item, type: 'ref' };
    }
    return null;
}

function add_conf(conf) {
    const { name, CPU: CPU_name = name, type } = conf;
    if (confs.exist(CPU_name, type)) throw new Error(`${CPU_name}:${type} has duplicate configurations`);
    // 按名称压入配置
    confs.set(CPU_name, type, conf);
    // 如没有则建立一个初始资源数据
    CPUs[CPU_name] ??= {
        name: CPU_name,
        symbols: [], // 符号表
        conn_ID_list: new IncreaseHashTable(16), // 已用连接ID列表
        module_addr_list: new IncreaseHashTable(256), // 模块地址列表
        DB_list: new IncreaseHashTable(100), // 已用数据块列表
        FB_list: new IncreaseHashTable(256), // 已用函数块列表
        FC_list: new IncreaseHashTable(256), // 已用函数列表
        poll_list: new IncreaseHashTable(1), // 已用查询号
        conn_host_list: {}, // 已用的连接地址列表
        output_dir: 'dist', // 输出文件夹
    }
    const CPU = CPUs[CPU_name];
    const symbols = CPU.symbols;
    add_symbols(symbols, conf.symbols ??= []);
    const options = conf.options ??= {};
    const list = conf.list ??= [];
    const item = { CPU, list, options };

    if (type === 'CPU') { // CPU 调度
        CPU.output_dir = conf.output_dir ?? CPU_name;
    } else if (type === 'AI') { // AI 调度
        list.forEach(AI => {
            if (!AI.DB) return; // 空AI不处理
            AI.DB = add_symbol(symbols, AI.DB, 'AI_Proc');
            AI.input = add_symbol(symbols, AI.input, 'WORD');
            if (typeof AI.input === 'string') {
                AI.input = to_ref(AI.input);
            }
        });
        AI_confs.push(item);
    } else if (type === 'modbusRTU' || type === 'MB') { // modebusTCP 调度
        options.MB340_FB = symbols.find((symbol) => symbol.comment === 'MB340_FB');
        options.MB341_FB = symbols.find((symbol) => symbol.comment === 'MB341_FB');
        options.MB_Loop = symbols.find((symbol) => symbol.comment === 'MB_Loop');
        options.polls_db = symbols.find((symbol) => symbol.comment === 'MB_polls_DB');
        list.forEach(module => {
            const FB = module.type === 'CP340' ? options.MB340_FB : options.MB341_FB;
            if (!FB) throw new Error(`${module.type}'s poll FB is not defined`);
            module.DB[2] = FB.name; // DB type
            module.DB = add_symbol(symbols, module.DB);
            module.polls.forEach(poll => {
                poll.recv_DB = add_symbol(symbols, poll.recv_DB, poll.recv_DB[0]);
            })
        })
        MB_confs.push(item);
    } else if (type === 'modbusTCP' || type === 'MT') { // modebusTCP 调度
        options.MB_TCP_Poll = symbols.find((symbol) => symbol.comment === 'MB_TCP_Poll');
        options.MT_Loop = symbols.find((symbol) => symbol.comment === 'MT_Loop');
        options.polls_db = symbols.find((symbol) => symbol.comment === 'MT_polls_DB');
        list.forEach(conn => {
            conn.DB[2] = options.MB_TCP_Poll.name; // DB type
            conn.DB = add_symbol(symbols, conn.DB);
            conn.polls.forEach(poll => {
                poll.recv_DB = add_symbol(symbols, poll.recv_DB, poll.recv_DB[0]);
            })
        })
        MT_confs.push(item);
    } else if (type === 'Valve' || type === 'valve') { // Valve 调度
        list.forEach(valve => {
            if (!valve.DB) return; // 空AI不处理
            valve.AI = add_symbol(symbols, valve.AI, 'WORD');
            if (!valve.AI?.name) valve.AI = to_ref(valve.AI); // 输入非符号
            valve.error = add_symbol(symbols, valve.error ?? false, 'BOOL');
            if (!valve.error?.name) valve.error = to_ref(valve.error); // 输入非符号
            valve.remote = add_symbol(symbols, valve.remote ?? true, 'BOOL');
            if (!valve.remote?.name) valve.remote = to_ref(valve.remote); // 输入非符号
            valve.CP = add_symbol(symbols, valve.CP, 'BOOL');
            valve.OP = add_symbol(symbols, valve.OP, 'BOOL');
            valve.close_action = add_symbol(symbols, valve.close_action, 'BOOL');
            valve.open_action = add_symbol(symbols, valve.open_action, 'BOOL');
            valve.DB = add_symbol(symbols, valve.DB, 'Valve_Proc');
        });
        valve_confs.push(item);
    }
}

const conf_path = new URL('../conf/', import.meta.url);
// load confs
try {
    for (const file of await readdir(conf_path)) {
        if (file.endsWith('.yml')) {
            const yaml_str = await readFile(new URL(file, conf_path), { encoding: 'utf8' });
            loadAll(yaml_str, add_conf);
        }
    }
} catch (e) {
    console.log(e);
}

// 生成无注释的配置 for of 实现异步顺序执行
for (const [name, conf_list] of confs.get_all()) {
    const docs = conf_list.map(conf => `---\n${dump(conf)}...`).join('\n\n');
    await writeFile(new URL(`${name}.zyml`, conf_path), docs);
}

// 检查并补全符号表
Object.values(CPUs).forEach(
    CPU => rebuild_symbols(CPU)
);

// 补全 modbusTCP 数据
MT_confs.forEach(gen_MT_data);

// 补全 modbusTCP 数据
MB_confs.forEach(gen_MB_data);

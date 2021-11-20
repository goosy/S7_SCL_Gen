import { dump, loadAll } from "js-yaml";
import { readdir, readFile, writeFile } from 'fs/promises';
import { gen_MT_data } from './gen_MT_data.js';
import { gen_symbols_data } from './gen_symbols_data.js';
import { IncreaseHashTable } from './increase_hash_table.js';

export const AI_confs = []; // 模拟量配置
export const valve_confs = []; // 阀门配置
export const MT_confs = []; // modbus TCP 配置
export const MB_confs = []; // modbus RTU 配置
export const CPUs = {}; // CPU 配置
export const symbols_dict = {}; // 符号定义字典
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

function add_conf(conf) {
    const { name, CPU: CPU_name = name, type } = conf;
    if (confs.exist(CPU_name, type)) throw new Error(`${CPU_name}:${type} has duplicate configurations`);
    // 按名称压入配置
    confs.set(CPU_name, type, conf);
    // 如没有则建立一个初始资源数据
    CPUs[CPU_name] ??= {
        name: CPU_name,
        conn_ID_list: new IncreaseHashTable(16), // 已用连接ID列表
        DB_list: new IncreaseHashTable(100), // 已用数据块列表
        FB_list: new IncreaseHashTable(256), // 已用函数块列表
        FC_list: new IncreaseHashTable(256), // 已用函数列表
        poll_list: new IncreaseHashTable(1), // 已用查询号
        conn_host_list: {}, // 已用的连接地址列表
        output_dir: 'dist', // 输出文件夹
    }
    const CPU = CPUs[CPU_name];
    const symbols = symbols_dict[CPU_name] ??= [];
    symbols.push(...(conf.symbols ??= []));
    const options = conf.options ??= {};
    const list = conf.list ??= [];
    const item = { CPU, symbols, list, options };

    if (type === 'CPU') { // CPU 调度
        CPU.output_dir = conf.output_dir ?? CPU_name;
    } else if (type === 'AI') { // AI 调度
        list.forEach(AI => {
            if (!AI.DB) return; // 空AI不处理
            if (AI.input != 'ref') { // 非ref并入符号表
                AI.input.type = 'WORD';
                symbols.push(AI.input);
            }
            AI.DB.type = 'AI_Proc';
            AI.DB.block_name = 'DB';
            symbols.push(AI.DB);
        });
        AI_confs.push(item);
    } else if (type === 'modbusTCP' || type === 'MT') { // modebusTCP 调度
        options.MB_TCP_Poll = symbols.find((symbol) => symbol.comment === 'MB_TCP_Poll');
        options.MT_Loop = symbols.find((symbol) => symbol.comment === 'MT_Loop');
        options.polls_db = symbols.find((symbol) => symbol.comment === 'polls_db');
        list.forEach(conn => {
            conn.DB.type = options.MB_TCP_Poll.name;
            conn.DB.block_name = 'DB';
            symbols.push(conn.DB);
            conn.polls.forEach(poll => {
                poll.recv_DB.block_name = 'DB';
                symbols.push(poll.recv_DB)
            })
        })
        MT_confs.push(item);
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
Object.entries(symbols_dict).forEach(
    ([cpu_name, symbols]) => gen_symbols_data(CPUs[cpu_name], symbols)
);

// 补全 modbusTCP 数据
MT_confs.forEach(gen_MT_data);

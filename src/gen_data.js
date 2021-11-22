import { dump, loadAll } from "js-yaml";
import { readdir, readFile, writeFile } from 'fs/promises';
import { gen_MT_data } from './gen_MT_data.js';
import { gen_MB_data } from './gen_MB_data.js';
import { rebuild, get_symbols} from './symbols.js';
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

function push_symbol(symbols, item, default_block_name, default_type) {
    if (item?.name && item.type != 'ref') { // 非ref并入符号表
        item.block_name ??= default_block_name;
        item.type ??= default_type;
        item.value = `"${item.name}"`;
        symbols.push(item);
    }
}
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
    const symbols = get_symbols(CPU_name); 
    symbols.push(...(conf.symbols ??= []));
    const options = conf.options ??= {};
    const list = conf.list ??= [];
    const item = { CPU, symbols, list, options };

    if (type === 'CPU') { // CPU 调度
        CPU.output_dir = conf.output_dir ?? CPU_name;
    } else if (type === 'AI') { // AI 调度
        list.forEach(AI => {
            if (!AI.DB) return; // 空AI不处理
            push_symbol(symbols, AI.DB, 'DB', 'AI_Proc');
            if (AI.input?.name) {
                push_symbol(symbols, AI.input, 'PIW', 'WORD');
            } else {
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
            if(!FB) throw new Error(`${module.type}'s poll FB is not defined`);
            module.DB.type = FB.name;
            module.DB.block_name = 'DB';
            symbols.push(module.DB);
            module.polls.forEach(poll => {
                push_symbol(symbols, poll.recv_DB, 'DB', poll.recv_DB);
            })
        })
        MB_confs.push(item);
    } else if (type === 'modbusTCP' || type === 'MT') { // modebusTCP 调度
        options.MB_TCP_Poll = symbols.find((symbol) => symbol.comment === 'MB_TCP_Poll');
        options.MT_Loop = symbols.find((symbol) => symbol.comment === 'MT_Loop');
        options.polls_db = symbols.find((symbol) => symbol.comment === 'MT_polls_DB');
        list.forEach(conn => {
            conn.DB.type = options.MB_TCP_Poll.name;
            conn.DB.block_name = 'DB';
            symbols.push(conn.DB);
            conn.polls.forEach(poll => {
                push_symbol(symbols, poll.recv_DB, 'DB', poll.recv_DB);
            })
        })
        MT_confs.push(item);
    } else if (type === 'Valve' || type === 'valve') { // Valve 调度
        list.forEach(valve => {
            if (!valve.DB) return; // 空AI不处理
            if (valve.AI) {
                if (valve.AI?.name) {
                    push_symbol(symbols, valve.AI, 'PIW', 'WORD');
                } else {
                    valve.AI = to_ref(valve.AI);
                }
            }
            valve.error ??= false;
            if (!valve.error?.name) valve.error = to_ref(valve.error);
            push_symbol(symbols, valve.error ?? false, 'I', 'BOOL');
            valve.remote ??= true;
            if (!valve.remote?.name) valve.remote = to_ref(valve.remote);
            push_symbol(symbols, valve.remote, 'I', 'BOOL');
            push_symbol(symbols, valve.CP, 'I', 'BOOL');
            push_symbol(symbols, valve.OP, 'I', 'BOOL');
            push_symbol(symbols, valve.close_action, 'Q', 'BOOL');
            push_symbol(symbols, valve.open_action, 'Q', 'BOOL');
            push_symbol(symbols, valve.DB, 'DB', 'Valve_Proc');
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
rebuild(CPUs);

// 补全 modbusTCP 数据
MT_confs.forEach(gen_MT_data);

// 补全 modbusTCP 数据
MB_confs.forEach(gen_MB_data);

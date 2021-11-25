import { dump, loadAll } from "js-yaml";
import { readdir, readFile, writeFile } from 'fs/promises';
import { gen_MT_data, MT_name } from './MT.js';
import { MB340_name, MB341_name, gen_MB_data } from './MB.js';
import { rebuild_symbols, add_symbol, add_symbols } from './symbols.js';
import { IntIncHL, S7IncHL } from './increase_hash_table.js';

const exist_dict = {}; // 保存列表
const confs_map = {}; // 配置列表
const confs = { // 全局维护表
    AI_confs: [], // 模拟量列表 {CPU,list,options}[]
    valve_confs: [], // 阀门列表 {CPU,list,options}[]
    MT_confs: [], // modbus RTU 列表 {CPU,list,options}[]
    MB_confs: [], // modbus TCP 列表 {CPU,list,options}[]
    symbols_confs: [], // symbols 列表 {CPU,list,options}[]
    CPUs: {}, // CPU 资源
};

function get_cpu(CPU_name) {
    // 如没有则建立一个初始资源数据
    return confs.CPUs[CPU_name] ??= {
        name: CPU_name,
        conn_ID_list: new IntIncHL(16), // 已用连接ID列表
        module_addr_list: new IntIncHL(256), // 模块地址列表
        DB_list: new IntIncHL(100), // 已用数据块列表
        FB_list: new IntIncHL(256), // 已用函数块列表
        FC_list: new IntIncHL(256), // 已用函数列表
        poll_list: new IntIncHL(1), // 已用查询号
        symbols: [], // 符号表
        MA_list: new S7IncHL([0, 0]), // 已用M地址
        conn_host_list: {}, // 已用的连接地址列表
        output_dir: CPU_name, // 输出文件夹
    }
}

function to_ref(item) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        return { value: item, type: 'ref' };
    }
    return null;
}
function exist(CPU, type) {
    return !!exist_dict[CPU + type];
}
function set_conf(CPU, type, conf) {
    exist_dict[CPU + type] = true;
    confs_map[CPU] ??= [];
    confs_map[CPU].push(conf);
}
function get_conf(CPU) {
    return confs_map[CPU];
}

function add_conf(conf) {
    const { name, CPU: CPU_name = name, type } = conf;
    if (exist(CPU_name, type)) throw new Error(`${CPU_name}:${type} has duplicate configurations`);
    // 按名称压入配置
    set_conf(CPU_name, type, conf);
    const CPU = get_cpu(CPU_name);
    const symbols = CPU.symbols;
    const options = conf.options ??= {};
    const list = conf.list ??= [];
    const item = { CPU, list, options };

    if (type === 'CPU') { // CPU 调度
        add_symbols(symbols, conf.symbols ??= []);
        CPU.output_dir = conf.output_dir ?? CPU_name;
    } else if (type === 'AI') { // AI 调度
        // 内置符号
        add_symbol(symbols, ['AI_Proc', 'FB512', 'FB512', 'AI main FB']);
        add_symbols(symbols, conf.symbols ??= []);
        list.forEach(AI => {
            if (!AI.DB) return; // 空AI不处理
            AI.DB = add_symbol(symbols, AI.DB, 'AI_Proc');
            AI.input = add_symbol(symbols, AI.input, 'WORD');
            if (typeof AI.input === 'string') {
                AI.input = to_ref(AI.input);
            }
        });
        confs.AI_confs.push(item);
    } else if (type === 'modbusRTU' || type === 'MB') { // modebusTCP 调度
        // 内置符号
        add_symbol(symbols, [MB340_name, 'FB345', 'FB345', 'CP340 main modbus FB']);
        add_symbol(symbols, [MB341_name, 'FB346', 'FB346', 'CP341 main modbus FB']);
        // 配置符号
        add_symbols(symbols, conf.symbols ??= []);
        list.forEach(module => {
            let valid_type = false;
            let type;
            if (module.type === 'CP341') {
                options.has_CP341 = true;
                valid_type = true;
                type = MB341_name;
            } else if (module.type === 'CP340') {
                options.has_CP340 = true;
                valid_type = true;
                type = MB340_name;
            }
            if (!valid_type) throw new Error(`${module.type}'s poll FB is not defined`);
            // CP DB
            module.DB[2] = type;
            module.DB = add_symbol(symbols, module.DB);
            module.polls.forEach(poll => {
                poll.recv_DB = add_symbol(symbols, poll.recv_DB, poll.recv_DB[0]);
            })
        })
        confs.MB_confs.push(item);
    } else if (type === 'modbusTCP' || type === 'MT') { // modebusTCP 调度
        // 内置符号
        add_symbol(symbols, [MT_name, 'FB347', 'FB347', 'main modbusTCP FB']);
        add_symbols(symbols, conf.symbols ??= []);
        list.forEach(conn => {
            conn.DB[2] = MT_name; // DB type
            conn.DB = add_symbol(symbols, conn.DB);
            conn.polls.forEach(poll => {
                poll.recv_DB = add_symbol(symbols, poll.recv_DB, poll.recv_DB[0]);
            })
        })
        confs.MT_confs.push(item);
    } else if (type === 'Valve' || type === 'valve') { // Valve 调度
        add_symbols(symbols, conf.symbols ??= []);
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
        confs.valve_confs.push(item);
    }
}

export async function gen_data(path) {
    // load confs
    try {
        for (const file of await readdir(path)) {
            if (file.endsWith('.yml')) {
                const yaml_str = await readFile(path + file, { encoding: 'utf8' });
                loadAll(yaml_str, add_conf);
            }
        }
    } catch (e) {
        console.log(e);
    }

    // 生成无注释的配置 for of 实现异步顺序执行
    for (const [name, conf_list] of Object.entries(confs_map)) {
        const docs = conf_list.map(conf => `---\n${dump(conf)}...`).join('\n\n');
        await writeFile(`${path}${name}.zyml`, docs);
    }

    // 检查并补全符号表
    Object.values(confs.CPUs).forEach(
        CPU => rebuild_symbols(CPU)
    );

    // 补全 modbusTCP 数据
    confs.MT_confs.forEach(gen_MT_data);

    // 补全 modbusTCP 数据
    confs.MB_confs.forEach(gen_MB_data);

    return confs;
}
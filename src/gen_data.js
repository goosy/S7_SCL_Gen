import { dump, loadAll } from "js-yaml";
import { readdir, readFile, writeFile } from 'fs/promises';
import { gen_MT_data } from './MT.js';
import { gen_MB_data } from './MB.js';
import {
    rebuild_symbols, add_symbol, add_symbols,
    AI_NAME, AI_BUILDIN,
    MT_NAME, MT_BUILDIN,
    MB340_NAME, MB341_NAME, MB_BUILDIN,
    VALVE_NAME, VALVE_BUILDIN
} from './symbols.js';
import { IntIncHL, S7IncHL } from './increase_hash_table.js';
import { lazyassign } from './lazyassign.js';
import { join } from 'path';

// 目前支持的类型
const TYPES = ['CPU', 'modbusRTU', 'modbusTCP', 'valve', 'AI'];

const AI_confs = []; // 模拟量列表 {CPU, list, options}[]
const valve_confs = []; // 阀门列表 {CPU, list, options}[]
const MT_confs = []; // modbus TCP 列表 {CPU, list, options}[]
const MB_confs = []; // modbus RTU 列表 {CPU, list, options}[]
const symbols_confs = []; // symbols 列表 {CPU, list, options}[]

const CPUs = {}; // CPU 资源
function get_cpu(CPU_name) {
    // 如没有则建立一个初始资源数据
    return CPUs[CPU_name] ??= {
        name: CPU_name,
        conn_ID_list: new IntIncHL(16), // 已用连接ID列表
        module_addr_list: new IntIncHL(256), // 模块地址列表
        DB_list: new IntIncHL(100), // 已用数据块列表
        FB_list: new IntIncHL(256), // 已用函数块列表
        FC_list: new IntIncHL(256), // 已用函数列表
        poll_list: new IntIncHL(1), // 已用查询号
        MA_list: new S7IncHL([0, 0]), // 已用M地址
        symbols_dict: {}, // 符号表
        conn_host_list: {}, // 已用的连接地址列表
        output_dir: CPU_name, // 输出文件夹
        push_conf(type, conf) {
            this[type] ??= [];
            this[type].push(conf);
        }
    }
}

function to_ref(item) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        return { value: item, type: 'ref' };
    }
    return item;
}

function make_prop_symbolic(obj, prop, symbols_dict, mtype) {
    if (Array.isArray(obj[prop]) && typeof mtype === 'string') {
        obj[prop][2] = mtype; // mandatory type
    }
    obj[prop] = to_ref(obj[prop]);
    // 全部符号未加载完，需要惰性赋值
    lazyassign(obj, prop, add_symbol(symbols_dict, obj[prop]));
}

function add_conf(conf) {
    // 检查重复
    const { name, CPU: CPU_name = name, type } = conf;
    let doctype = '';
    if (type.toUpperCase() === 'AI') doctype = 'AI';
    if (type.toUpperCase() === 'CPU') doctype = 'CPU';
    if (type.toUpperCase() === 'MB' || type.toLowerCase() === 'modbusrtu') doctype = 'modbusRTU';
    if (type.toUpperCase() === 'MT' || type.toLowerCase() === 'modbustcp') doctype = 'modbusTCP';
    if (type.toLowerCase() === 'valve') doctype = 'valve';
    if (!TYPES.includes(doctype)) throw new Error(`type:${type} has not supported`);
    const CPU = get_cpu(CPU_name);
    if (CPU[doctype]) throw new Error(`${CPU_name}:${doctype}${doctype == type ? '(' + type + ')' : ''} has duplicate configurations`);
    CPU.push_conf(doctype, dump(conf)); // 按名称压入无注释配置文本

    // conf 存在属性为 null 但不是 undefined 的情况，不能解构赋值
    const options = conf.options ?? {};
    const list = conf.list ?? [];
    const symbols = conf.symbols ?? [];
    const symbols_dict = CPU.symbols_dict;
    const item = { CPU, list, options };
    if (doctype === 'AI') add_symbols(symbols_dict, AI_BUILDIN); // 加入AI内置符号
    if (doctype === 'modbusRTU') add_symbols(symbols_dict, MB_BUILDIN); // 加入MB内置符号
    if (doctype === 'modbusTCP') add_symbols(symbols_dict, MT_BUILDIN); // 加入MT内置符号
    if (doctype === 'valve') add_symbols(symbols_dict, VALVE_BUILDIN); // 加入Valve内置符号
    add_symbols(symbols_dict, symbols); // 加入前置符号

    // 调度配置
    if (doctype === 'CPU') { // CPU 调度
        CPU.output_dir = conf.output_dir ?? CPU_name;
    } else if (doctype === 'AI') { // AI 调度
        // 配置
        list.forEach(AI => {
            if (!AI.DB) return; // 空AI不处理
            make_prop_symbolic(AI, 'DB', symbols_dict, AI_NAME);
            make_prop_symbolic(AI, 'input', symbols_dict, 'WORD');
        });
        AI_confs.push(item);
    } else if (doctype === 'modbusRTU') { // modebusTCP 调度
        list.forEach(module => {
            let valid_type = false;
            let type;
            if (module.type === 'CP341') {
                options.has_CP341 = true;
                valid_type = true;
                type = MB341_NAME;
            } else if (module.type === 'CP340') {
                options.has_CP340 = true;
                valid_type = true;
                type = MB340_NAME;
            }
            if (!valid_type) throw new Error(`${module.type}'s poll FB is not defined`);
            // CP DB
            make_prop_symbolic(module, 'DB', symbols_dict, type);
            module.polls.forEach(poll => {
                make_prop_symbolic(poll, 'recv_DB', symbols_dict);
            })
        })
        MB_confs.push(item);
    } else if (doctype === 'modbusTCP' || doctype === 'MT') { // modebusTCP 调度
        list.forEach(conn => {
            make_prop_symbolic(conn, 'DB', symbols_dict, MT_NAME);
            conn.polls.forEach(poll => {
                make_prop_symbolic(poll, 'recv_DB', symbols_dict);
            })
        })
        MT_confs.push(item);
    } else if (doctype === 'Valve' || doctype === 'valve') { // Valve 调度
        list.forEach(valve => {
            if (!valve.DB) return; // 空AI不处理
            make_prop_symbolic(valve, 'AI', symbols_dict, 'WORD');
            make_prop_symbolic(valve, 'CP', symbols_dict, 'BOOL');
            make_prop_symbolic(valve, 'OP', symbols_dict, 'BOOL');
            make_prop_symbolic(valve, 'remote', symbols_dict, 'BOOL');
            make_prop_symbolic(valve, 'error', symbols_dict, 'BOOL');
            make_prop_symbolic(valve, 'close_action', symbols_dict, 'BOOL');
            make_prop_symbolic(valve, 'open_action', symbols_dict, 'BOOL');
            make_prop_symbolic(valve, 'DB', symbols_dict, VALVE_NAME);
        });
        valve_confs.push(item);
    }
}

export async function gen_data(path) {
    // load confs
    try {
        for (const file of await readdir(path)) {
            if (file.endsWith('.yml')) {
                const filename = join(path, file);
                console.log(`readding ${filename}`)
                const yaml_str = await readFile(filename, { encoding: 'utf8' });
                loadAll(yaml_str, add_conf);
            }
        }
    } catch (e) {
        console.log(e);
    }

    for (const [name, CPU] of Object.entries(CPUs)) {
        // 生成无注释的配置
        const docs = TYPES.map(type => `---\n${CPU[type]}...`).join('\n\n');
        const filename = `${join(path, name)}.zyml`;
        await writeFile(filename, docs);
        console.log(`output the no comment configuration file: ${filename}`);
        // 检查并补全符号表
        const symbol_conf = rebuild_symbols(CPU);
        symbols_confs.push(symbol_conf)
    }

    // 补全 modbusTCP 数据
    MT_confs.forEach(gen_MT_data);

    // 补全 modbusTCP 数据
    MB_confs.forEach(gen_MB_data);

    return { symbols_confs, MB_confs, MT_confs, AI_confs, valve_confs };
}
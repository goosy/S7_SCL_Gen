import { dump, loadAll } from "js-yaml";
import { readdir, writeFile } from 'fs/promises';
import { gen_AI } from "./AI.js";
import { gen_MT, gen_MT_data } from './MT.js';
import { gen_CP, gen_CP_data } from './CP.js';
import { gen_valve } from "./valve.js";
import { gen_common } from "./common.js";
import {
    gen_symbol, rebuild_symbols, add_symbol, add_symbols,
    AI_NAME, AI_BUILDIN,
    MT_NAME, MT_BUILDIN,
    CP340_NAME, CP341_NAME, CP_BUILDIN,
    VALVE_NAME, VALVE_BUILDIN
} from './symbols.js';
import { IntIncHL, S7IncHL, lazyassign, read_file } from './util.js';
import { join } from 'path';

// 目前支持的类型
const TYPES = ['CPU', 'SC', 'modbusTCP', 'valve', 'AI'];

const AI_list = []; // 模拟量列表 {CPU， includes, list, options}[]
const valve_list = []; // 阀门列表 {CPU， includes, list, options}[]
const MT_list = []; // modbusTCP 列表 {CPU， includes, list, options}[]
const CP_list = []; // 串行通信列表 {CPU， includes, list, options}[]
const symbols_list = []; // symbols 列表 {CPU， includes, list, options}[]
const common_list = []; // 通用列表 {CPU， includes, list, options}[]

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
        IA_list: new S7IncHL([0, 0]), // 已用I地址
        QA_list: new S7IncHL([0, 0]), // 已用I地址
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
    if (type.toUpperCase() === 'MB' || type.toUpperCase() === 'SC') doctype = 'SC';
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
    const includes = conf.includes ?? [];
    const item = { CPU, list, includes, options };
    if (doctype === 'AI') add_symbols(symbols_dict, AI_BUILDIN); // 加入AI内置符号
    if (doctype === 'SC') add_symbols(symbols_dict, CP_BUILDIN); // 加入SC内置符号
    if (doctype === 'modbusTCP') add_symbols(symbols_dict, MT_BUILDIN); // 加入MT内置符号
    if (doctype === 'valve') add_symbols(symbols_dict, VALVE_BUILDIN); // 加入Valve内置符号
    add_symbols(symbols_dict, symbols); // 加入前置符号

    // 调度配置
    if (doctype === 'CPU') { // CPU 调度
        CPU.output_dir = conf?.options?.output_dir ?? CPU_name;
        common_list.push(item);
    } else if (doctype === 'AI') { // AI 调度
        // 配置
        list.forEach(AI => {
            if (!AI.DB) return; // 空AI不处理
            make_prop_symbolic(AI, 'DB', symbols_dict, AI_NAME);
            make_prop_symbolic(AI, 'input', symbols_dict, 'WORD');
        });
        AI_list.push(item);
    } else if (doctype === 'SC') { // SC 调度
        list.forEach(module => {
            let valid_type = false;
            let type;
            if (module.type === 'CP341') {
                options.has_CP341 = true;
                valid_type = true;
                type = CP341_NAME;
            } else if (module.type === 'CP340') {
                options.has_CP340 = true;
                valid_type = true;
                type = CP340_NAME;
            }
            if (!valid_type) throw new Error(`${module.type}'s poll FB is not defined`);
            // CP DB
            make_prop_symbolic(module, 'DB', symbols_dict, type);
            module.polls.forEach(poll => {
                make_prop_symbolic(poll, 'recv_DB', symbols_dict);
            })
        })
        CP_list.push(item);
    } else if (doctype === 'modbusTCP' || doctype === 'MT') { // modebusTCP 调度
        list.forEach(conn => {
            make_prop_symbolic(conn, 'DB', symbols_dict, MT_NAME);
            conn.polls.forEach(poll => {
                make_prop_symbolic(poll, 'recv_DB', symbols_dict);
            })
        })
        MT_list.push(item);
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
        valve_list.push(item);
    }
}

export async function gen_data(path) {
    // load confs
    try {
        console.log('readding file:');
        for (const file of await readdir(path)) {
            if (file.endsWith('.yml')) {
                const filename = join(path, file);
                loadAll(await read_file(filename), add_conf);
                console.log(`\t${filename}`);
            }
        }
    } catch (e) {
        console.log(e);
    }

    console.log('output the no comment configuration file:');
    for (const [name, CPU] of Object.entries(CPUs)) {
        // 生成无注释的配置
        const head = `# CPU ${name} configuration`;
        const yaml = TYPES.reduce(
            (docs, type) => CPU[type] ? `${docs}\n\n---\n${CPU[type]}...` : docs,
            head
        );
        const filename = `${join(path, name)}.zyml`;
        await writeFile(filename, yaml);
        console.log(`\t${filename}`);
        // 检查并补全符号表
        const symbol_conf = rebuild_symbols(CPU);
        symbols_list.push(symbol_conf)
    }


    const work_path = process.cwd();
    const copy_list = [];
    // 补全数据
    CP_list.forEach(gen_CP_data);
    MT_list.forEach(gen_MT_data);
    async function gen_includes(includes) {
        let code = '';
        for (const file of includes) {
            code += await read_file(file) + '\n';
        }
        return code;
    }
    
    for (const common of common_list) {
        common.includes = await gen_includes(common.includes);
    }
    for (const AI of AI_list) {
        AI.includes = await gen_includes(AI.includes);
        const output_dir = AI.CPU.output_dir;
        copy_list.push([`AI_Proc/${AI_NAME}(step7).scl`, `${output_dir}/${AI_NAME}.scl`, `${join(work_path, output_dir, AI_NAME)}.scl`]);
    }
    for (const CP of CP_list) {
        CP.includes = await gen_includes(CP.includes);
        const output_dir = CP.CPU.output_dir;
        if (CP.options.has_CP340) {
            copy_list.push([`CP_Poll/${CP340_NAME}.scl`, `${output_dir}/`, `${join(work_path, output_dir, CP340_NAME)}.scl`]);
        }
        if (CP.options.has_CP341) {
            copy_list.push([`CP_Poll/${CP341_NAME}.scl`, `${output_dir}/`, `${join(work_path, output_dir, CP341_NAME)}.scl`]);
        }
    }
    for (const MT of MT_list) {
        MT.includes = await gen_includes(MT.includes);
        const output_dir = MT.CPU.output_dir;
        copy_list.push([`MT_Poll/${MT_NAME}.scl`, `${output_dir}/`, `${join(work_path, output_dir, MT_NAME)}.scl`]);
    }
    for (const valve of valve_list) {
        valve.includes = await gen_includes(valve.includes);
        const output_dir = valve.CPU.output_dir;
        copy_list.push([`Valve_Proc/${VALVE_NAME}.scl`, `${output_dir}/`, `${join(work_path, output_dir, VALVE_NAME)}.scl`]);
    }

    const convert_list = [
        gen_common(common_list),
        gen_symbol(symbols_list),
        gen_AI(AI_list),
        gen_CP(CP_list),
        gen_MT(MT_list),
        gen_valve(valve_list)
    ];
    return [copy_list, convert_list];
}

import { dump, loadAll } from "js-yaml";
import { readdir, writeFile } from 'fs/promises';
import { parse_symbols_AI, gen_AI } from "./AI.js";
import { parse_symbols_MT, build_MT, gen_MT } from './MT.js';
import { parse_symbols_CP, build_CP, gen_CP } from './CP.js';
import { parse_symbols_valve, gen_valve } from "./valve.js";
import { gen_common } from "./common.js";
import {
    gen_symbol, build_symbols, add_symbols,
    AI_NAME, AI_BUILDIN,
    MT_NAME, MT_BUILDIN,
    CP340_NAME, CP341_NAME, CP_BUILDIN,
    VALVE_NAME, VALVE_BUILDIN
} from './symbols.js';
import { IntIncHL, S7IncHL,  read_file } from './util.js';
import { join } from 'path';

// 目前支持的类型
const TYPES = ['CPU', 'AI', 'SC', 'modbusTCP', 'valve'];

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
            this[type] = {
                source: conf,
            };
        }
    }
}

async function gen_includes(includes) {
    let code = '';
    for (const file of includes) {
        code += await read_file(file) + '\n';
    }
    return code;
}

// 第一遍扫描，仅提取符号
function add_conf(conf) {
    // 检查重复
    const { name, CPU: CPU_name = name, type } = conf;
    if (typeof CPU_name !== 'string') throw new SyntaxError(' name(CPU) 必须提供！');
    if (typeof type !== 'string') throw new SyntaxError(' type 必须提供！');
    let doctype = '';
    if (type.toUpperCase() === 'AI') doctype = 'AI';
    if (type.toUpperCase() === 'CPU') doctype = 'CPU';
    if (type.toUpperCase() === 'MB' || type.toUpperCase() === 'SC') doctype = 'SC';
    if (type.toUpperCase() === 'MT' || type.toLowerCase() === 'modbustcp') doctype = 'modbusTCP';
    if (type.toLowerCase() === 'valve') doctype = 'valve';
    if (!TYPES.includes(doctype)) throw new SyntaxError(`type:${type} has not supported`);
    const CPU = get_cpu(CPU_name);
    if (CPU[doctype]) throw new SyntaxError(`${CPU_name}:${doctype}${doctype == type ? '(' + type + ')' : ''} has duplicate configurations`);
    CPU.push_conf(doctype, dump(conf)); // 按名称压入无注释配置文本

    // conf 存在属性为 null 但不是 undefined 的情况，不能解构赋值
    const options = conf.options ?? {};
    const list = conf.list ?? [];
    const symbols = conf.symbols ?? [];
    const symbols_dict = CPU.symbols_dict;
    const includes = conf.includes ?? [];
    const area = { CPU, list, includes, options };

    // 加入内置符号
    if (doctype === 'AI') add_symbols(symbols_dict, AI_BUILDIN);
    if (doctype === 'SC') add_symbols(symbols_dict, CP_BUILDIN);
    if (doctype === 'modbusTCP') add_symbols(symbols_dict, MT_BUILDIN);
    if (doctype === 'valve') add_symbols(symbols_dict, VALVE_BUILDIN);
    add_symbols(symbols_dict, symbols); // 加入前置符号

    if (doctype === 'CPU') {
        CPU.output_dir = conf?.options?.output_dir ?? CPU_name;
        common_list.push(area);
    } else if (doctype === 'AI') {
        parse_symbols_AI(area);
        AI_list.push(area);
    } else if (doctype === 'SC') {
        parse_symbols_CP(area);
        CP_list.push(area);
    } else if (doctype === 'modbusTCP' || doctype === 'MT') { 
        parse_symbols_MT(area);
        MT_list.push(area);
    } else if (doctype === 'Valve' || doctype === 'valve') {
        parse_symbols_valve(area);
        valve_list.push(area);
    }
}

export async function gen_data() {
    const work_path = process.cwd();

    // 第一遍扫描 加载配置并提取符号
    try {
        console.log('readding file:');
        for (const file of await readdir(work_path)) {
            if (file.endsWith('.yml')) {
                const filename = join(work_path, file);
                const docs = loadAll(await read_file(filename));
                for (const [index, doc] of docs.entries()) {
                    try {
                        add_conf(doc);
                    } catch (err) {
                        if (err instanceof SyntaxError) {
                            throw new Error(`${filename} 第${index + 1}个文档：${err.message}`, { cause: err });
                        }
                        throw new Error(err.message, { cause: err });
                    }
                }
                console.log(`\t${filename}`);
            }
        }
    } catch (e) {
        console.log(e);
    }

    // 第二遍扫描 补全数据
    console.log('output the no comment configuration file:');
    for (const [name, CPU] of Object.entries(CPUs)) {
        // 生成无注释的配置
        const head = `# CPU ${name} configuration`;
        const yaml = TYPES.reduce(
            (docs, type) => CPU[type]?.source ? `${docs}\n\n---\n${CPU[type].source}...` : docs,
            head
        );
        const filename = `${join(work_path, name)}.zyml`;
        await writeFile(filename, yaml);
        console.log(`\t${filename}`);
        // 检查并补全符号表
        const symbol_conf = build_symbols(CPU);
        symbols_list.push(symbol_conf)
    }

    const copy_list = [];
    CP_list.forEach(build_CP);
    MT_list.forEach(build_MT);

    // 第三遍扫描 生成最终待转换数据
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

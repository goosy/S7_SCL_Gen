import { dump, load, loadAll } from "js-yaml";
import { readdir, writeFile } from 'fs/promises';

import { parse_symbols_AI, gen_AI } from "./AI.js";
import { parse_symbols_PI, build_PI, gen_PI } from "./PI.js";
import { parse_symbols_MT, build_MT, gen_MT } from './MT.js';
import { parse_symbols_CP, build_CP, gen_CP } from './CP.js';
import { parse_symbols_valve, gen_valve } from "./valve.js";
import { parse_symbols_motor, build_motor, gen_motor } from "./motor.js";
import { gen_common } from "./common.js";
import {
  gen_symbol, build_symbols, add_symbols,
  AI_NAME, AI_BUILDIN,
  PI_NAME, PI_BUILDIN,
  MT_NAME, MT_BUILDIN,
  CP340_NAME, CP341_NAME, CP_BUILDIN,
  VALVE_NAME, VALVE_BUILDIN,
  MOTOR_NAME, MOTOR_BUILDIN,
} from './symbols.js';
import { IntIncHL, S7IncHL, read_file } from './util.js';
import { trace_info } from './trace_info.js'
import { join } from 'path';

// 目前支持的类型
const TYPES = ['CPU', 'AI', 'PI', 'SC', 'modbusTCP', 'valve', 'motor'];

const AI_list = []; // 模拟量列表 {CPU， includes, list, options}[]
const PI_list = []; // 模拟量列表 {CPU， includes, list, options}[]
const valve_list = []; // 阀门列表 {CPU， includes, list, options}[]
const motor_list = []; // 电机列表 {CPU， includes, list, options}[]
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
    UDT_list: new IntIncHL(256), // 已用自定义类型列表
    poll_list: new IntIncHL(1), // 已用查询号
    MA_list: new S7IncHL([0, 0]), // 已用M地址
    IA_list: new S7IncHL([0, 0]), // 已用I地址
    QA_list: new S7IncHL([0, 0]), // 已用I地址
    symbols_dict: {}, // 符号表
    conn_host_list: {}, // 已用的连接地址列表
    output_dir: CPU_name, // 输出文件夹
    push_conf(type, conf) {
      this[type] = conf;
    }
  }
}

async function fetch_includes(files) {
  if (typeof files == 'string') return files;
  if (!Array.isArray(files)) return '';
  let code = '';
  try {
    for (const file of files) {
      code += await read_file(file) + '\n';
    };
  } catch (err) {
    code = '';
    log.error(err.message);
  }
  return code;
}

// 第一遍扫描，仅提取符号
async function add_conf(conf) {
  // 检查重复
  const { name, CPU: CPU_name = name, type } = conf;
  if (typeof CPU_name !== 'string') throw new SyntaxError(' name(CPU) 必须提供！');
  trace_info.CPU = CPU_name;
  if (typeof type !== 'string') throw new SyntaxError(' type 必须提供！');
  let doctype = '';
  if (type.toUpperCase() === 'AI') doctype = 'AI';
  else if (type.toUpperCase() === 'PI') doctype = 'PI';
  else if (type.toUpperCase() === 'CPU') doctype = 'CPU';
  else if (type.toUpperCase() === 'MB' || type.toUpperCase() === 'SC') doctype = 'SC';
  else if (type.toUpperCase() === 'MT' || type.toLowerCase() === 'modbustcp') doctype = 'modbusTCP';
  else if (type.toLowerCase() === 'valve') doctype = 'valve';
  else if (type.toLowerCase() === 'motor') doctype = 'motor';
  else {
    console.error(`${trace_info.filename}文件 ${CPU_name}:${type}文档 : 该类型转换系统不支持`);
    process.exit(1);
  }
  const CPU = get_cpu(CPU_name);
  if (CPU[doctype]) {
    console.error(`${CPU_name}:${doctype}${doctype == type ? '(' + type + ')' : ''} 有重复的配置 has duplicate configurations`);
    process.exit(2);
  }
  CPU.push_conf(doctype, dump(conf)); // 按名称压入无注释配置文本
  trace_info.type = doctype;
  trace_info.push_doc();

  function parse_symbols_in_SCL(SCL) {
    const code = SCL.replace(/(^|\n)\s*\(\*(symbols:\s+[\s\S]*?)\*\)/g, (m, m1, yaml) => {
      const symbols = load(yaml)['symbols']?.map(symbol => {
        symbol[3] ??= 'symbol from files of includes';
        return symbol;
      })
      add_symbols(symbols_dict, symbols ?? []);
      return '';
    })
    return code;
  }

  // conf 存在属性为 null 但不是 undefined 的情况，故不能解构赋值
  const options = conf.options ?? {};
  const list = conf.list ?? [];
  const symbols = conf.symbols ?? [];
  const symbols_dict = CPU.symbols_dict;
  const loop_additional_code = await fetch_includes(conf.loop_additional_code);
  // 加入 includes 符号
  const includes = parse_symbols_in_SCL(await fetch_includes(conf.includes));
  // 加入内置符号
  if (doctype === 'AI') add_symbols(symbols_dict, AI_BUILDIN);
  else if (doctype === 'PI') add_symbols(symbols_dict, PI_BUILDIN);
  else if (doctype === 'SC') add_symbols(symbols_dict, CP_BUILDIN);
  else if (doctype === 'modbusTCP') add_symbols(symbols_dict, MT_BUILDIN);
  else if (doctype === 'valve') add_symbols(symbols_dict, VALVE_BUILDIN);
  else if (doctype === 'motor') add_symbols(symbols_dict, MOTOR_BUILDIN);
  // 加入前置符号
  add_symbols(symbols_dict, symbols);

  const area = { CPU, list, includes, loop_additional_code, options };
  if (doctype === 'CPU') {
    CPU.output_dir = conf?.options?.output_dir ?? CPU_name;
    common_list.push(area);
  } else if (doctype === 'AI') {
    parse_symbols_AI(area);
    AI_list.push(area);
  } else if (doctype === 'PI') {
    parse_symbols_PI(area);
    PI_list.push(area);
  } else if (doctype === 'SC') {
    parse_symbols_CP(area);
    CP_list.push(area);
  } else if (doctype === 'modbusTCP') {
    parse_symbols_MT(area);
    MT_list.push(area);
  } else if (doctype === 'valve') {
    parse_symbols_valve(area);
    valve_list.push(area);
  } else if (doctype === 'motor') {
    parse_symbols_motor(area);
    motor_list.push(area);
  }
}

export async function gen_data() {
  const work_path = process.cwd();

  // 第一遍扫描 加载配置\提取符号\建立诊断信息
  try {
    console.log('readding file:');
    for (const file of await readdir(work_path)) {
      if (file.endsWith('.yml')) {
        const filename = join(work_path, file);
        trace_info.filename = filename;
        trace_info.doc_index = 0;
        const docs = loadAll(await read_file(filename));
        for (const [index, doc] of docs.entries()) {
          trace_info.doc_index = index + 1;
          await add_conf(doc);
        }
        console.log(`\t${filename}`);
      }
    }
    trace_info.clear();
  } catch (e) {
    console.log(e);
  }

  // 第二遍扫描 补全数据
  console.log('output the no comment configuration file:');
  for (const [name, CPU] of Object.entries(CPUs)) {
    // 生成无注释的配置
    const yaml = TYPES.reduce(
      (docs, type) => CPU[type] ? `${docs}\n\n---\n${CPU[type]}...` : docs,
      `# CPU ${name} configuration`
    );
    const filename = `${join(work_path, name)}.zyml`;
    await writeFile(filename, yaml);
    console.log(`\t${filename}`);
    // 检查并补全符号表
    const symbol_conf = build_symbols(CPU);
    symbols_list.push(symbol_conf)
  }

  const copy_list = [];
  PI_list.forEach(build_PI);
  CP_list.forEach(build_CP);
  MT_list.forEach(build_MT);
  motor_list.forEach(build_motor);

  // 第三遍扫描 生成最终待转换数据
  for (const AI of AI_list) {
    const output_dir = AI.CPU.output_dir;
    copy_list.push([`AI_Proc/${AI_NAME}(step7).scl`, `${output_dir}/${AI_NAME}.scl`, `${join(work_path, output_dir, AI_NAME)}.scl`]);
  }
  for (const PI of PI_list) {
    const output_dir = PI.CPU.output_dir;
    copy_list.push([`PI_Proc/${PI_NAME}.scl`, `${output_dir}/${PI_NAME}.scl`, `${join(work_path, output_dir, PI_NAME)}.scl`]);
  }
  for (const CP of CP_list) {
    const output_dir = CP.CPU.output_dir;
    if (CP.options.has_CP340) {
      copy_list.push([`CP_Poll/${CP340_NAME}.scl`, `${output_dir}/`, `${join(work_path, output_dir, CP340_NAME)}.scl`]);
    }
    if (CP.options.has_CP341) {
      copy_list.push([`CP_Poll/${CP341_NAME}.scl`, `${output_dir}/`, `${join(work_path, output_dir, CP341_NAME)}.scl`]);
    }
  }
  for (const MT of MT_list) {
    const output_dir = MT.CPU.output_dir;
    copy_list.push([`MT_Poll/${MT_NAME}.scl`, `${output_dir}/`, `${join(work_path, output_dir, MT_NAME)}.scl`]);
  }
  for (const valve of valve_list) {
    const output_dir = valve.CPU.output_dir;
    copy_list.push([`Valve_Proc/${VALVE_NAME}.scl`, `${output_dir}/`, `${join(work_path, output_dir, VALVE_NAME)}.scl`]);
  }
  for (const motor of motor_list) {
    const output_dir = motor.CPU.output_dir;
    copy_list.push([`Motor_Proc/${MOTOR_NAME}.scl`, `${output_dir}/`, `${join(work_path, output_dir, MOTOR_NAME)}.scl`]);
  }

  const convert_list = [
    gen_common(common_list),
    gen_symbol(symbols_list),
    gen_AI(AI_list),
    gen_PI(PI_list),
    gen_CP(CP_list),
    gen_MT(MT_list),
    gen_valve(valve_list),
    gen_motor(motor_list),
  ];
  return [copy_list, convert_list];
}

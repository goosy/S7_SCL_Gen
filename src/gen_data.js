import { readdir, writeFile } from 'fs/promises';
import { build_symbols, add_symbols, gen_symbols, BUILDIN_SYMBOLS } from './symbols.js';
import { IntIncHL, S7IncHL } from './util.js';
import { GCL } from './gcl.js';
import { join } from 'path';
import { supported_types, converter } from './converter.js';
import assert from 'assert/strict';

/** @type {string: {CPU, includes, list, options}[] }*/
const conf_list = {};
supported_types.forEach(type => {
  // 初始化conf_list
  conf_list[type] = [];
});

const CPUs = { // CPU 资源
  get(CPU_name) {
    // 从已有CPU中找，如没有则建立一个初始CPU资源数据
    return CPUs[CPU_name] ??= {
      name: CPU_name,
      conn_ID_list: new IntIncHL(16), // 已用连接ID列表
      OB_list: new IntIncHL(100),     // 已用组织块列表
      DB_list: new IntIncHL(100),     // 已用数据块列表
      FB_list: new IntIncHL(256),     // 已用函数块列表
      FC_list: new IntIncHL(256),     // 已用函数列表
      UDT_list: new IntIncHL(256),    // 已用自定义类型列表
      poll_list: new IntIncHL(1),     // 已用查询号
      MA_list: new S7IncHL([0, 0]),   // 已用M地址
      IA_list: new S7IncHL([0, 0]),   // 已用I地址
      QA_list: new S7IncHL([0, 0]),   // 已用Q地址
      PIA_list: new S7IncHL([0, 0]),  // 已用PI地址
      PQA_list: new S7IncHL([0, 0]),  // 已用PQ地址
      symbols_dict: {},               // 符号字典
      conn_host_list: {},             // 已用的连接地址列表
      output_dir: CPU_name,           // 输出文件夹
      add_type(type, document) {      // 按类型压入Document
        this[type] = document;
      }
    };
  },
};
Object.defineProperty(CPUs, 'get', {
  enumerable: false,
  configurable: false,
  writable: false
});


async function parse_includes(includes, options) {
  let gcl_list = [], code = '';
  if (typeof includes == 'string') return { code: includes, gcl_list };
  if (!Array.isArray(includes)) return { code: '', gcl_list };
  try {
    for (const filename of includes) {
      const gcl = new GCL();
      await gcl.load(filename, { ...options, encoding: 'utf8', inSCL: true });
      gcl_list.push(gcl);
    };
    code = gcl_list.map(gcl => gcl.SCL).join('\n');
  } catch (err) {
    code = '';
    console.error(err.message);
  }
  return { code, gcl_list };
}

/**
 * check if its supported document type
 * returns the standard type name if supported
 * else return undefined
 * @param {string} type
 * @returns {string|undefined}
 */
function is_supported_type(type) {
  return supported_types.find(t => converter[`is_type_${t}`](type));
}

/**
 * 加入指定GCL文件的所有文档
 * 生命周期为第一遍扫描，主要功能是提取符号
 * @date 2022-07-03
 * @param {GCL} gcl
 * @param {number} index
 */
async function add_conf(gcl) {
  for (const doc of gcl.documents) {
    // 检查重复
    const { CPU: CPU_name, type } = doc;
    assert.equal(typeof CPU_name, 'string', new SyntaxError(' name (或者CPU) 必须提供!'));
    assert.equal(typeof type, 'string', new SyntaxError(' type 必须提供!'));
    const doctype = is_supported_type(type);
    if (!doctype) {
      console.error(`${gcl.file}文件 ${CPU_name}:${type}文档 : 该类型转换系统不支持`);
      return;
    }
    const CPU = CPUs.get(CPU_name);
    if (doctype === 'CPU') CPU.device = doc.get('device');
    if (CPU[doctype]) {
      console.error(`"${gcl.file}"文件的配置 (${CPU_name}-${doctype}) 已存在`);
      process.exit(2);
    }
    CPU.add_type(doctype, doc); // 按名称压入文档

    // conf 存在属性为 null 但不是 undefined 的情况，故不能解构赋值
    const conf = doc.toJS();
    const options = conf.options ?? {};
    const list = conf.list ?? [];
    const { code: loop_additional_code, gcl_list: _ } = await parse_includes(conf.loop_additional_code, { CPU: CPU.name, type: doctype });
    const { code: includes, gcl_list } = await parse_includes(conf.includes, { CPU: CPU.name, type: doctype });
    // 加入 includes 符号
    gcl_list.forEach(gcl => {
      gcl.documents.forEach(doc => {
        const symbols = doc.get('symbols');
        add_symbols(CPU, symbols ?? [], { document: doc });
      })
    })
    // 加入内置符号
    const buildin = BUILDIN_SYMBOLS[doctype];
    add_symbols(CPU, buildin.get('symbols'), { document: buildin });
    // 加入前置符号
    const symbols = doc.get('symbols');
    if (symbols) add_symbols(CPU, symbols, { document: doc });

    const area = { CPU, list, includes, loop_additional_code, options, gcl };
    const parse_symbols = converter[`parse_symbols_${doctype}`];
    if (typeof parse_symbols === 'function') parse_symbols(area);
    conf_list[doctype].push(area);
  }
}

export async function gen_data({ output_zyml, noconvert, silent } = {}) {
  const work_path = process.cwd();

  // 第一遍扫描 加载配置\提取符号\建立诊断信息
  try {
    silent || console.log('readding file:');
    for (const file of await readdir(work_path)) {
      if (/^.*\.ya?ml$/i.test(file)) {
        const filename = join(work_path, file);
        const gcl = new GCL();
        await gcl.load(filename);
        await add_conf(gcl);
        silent || console.log(`\t${filename}`);
      }
    }
  } catch (e) {
    console.log(e);
  }

  // 输出无注释配置
  if (output_zyml) {
    console.log('output the uncommented configuration file:');
    const options = {
      commentString() { return ''; },
      indentSeq: false
    }
    for (const [name, CPU] of Object.entries(CPUs)) {
      // 生成无注释的配置
      const yaml = supported_types.reduce(
        (docs, type) => CPU[type] ? `${docs}\n\n${CPU[type].toString(options)}` : docs,
        `# CPU ${name} configuration`
      );
      const filename = `${join(work_path, name)}.zyml`;
      await writeFile(filename, yaml);
      console.log(`\t${filename}`);
    }
  }

  // 第二遍扫描 补全数据

  // 检查并补全符号表
  for (const CPU of Object.values(CPUs)) {
    build_symbols(CPU);
  }

  for (const [type, list] of Object.entries(conf_list)) {
    const build = converter['build_' + type];
    if (typeof build === 'function') list.forEach(build);
  };

  // 校验完毕，由 noconvert 变量决定是否输出
  if (noconvert) return [[], []];

  // 第三遍扫描 生成最终待转换数据
  const copy_list = [];
  const convert_list = [];
  supported_types.forEach(type => {
    for (const item of conf_list[type]) {
      const gen = converter[`gen_${type}_copy_list`];
      assert.equal(typeof gen, 'function', `innal error: gen_${type}_copy_list`);
      const ret = gen(item);
      assert(Array.isArray(ret), `innal error: gen_${type}_copy_list(${item}) is not a Array`);
      copy_list.push(...ret);
    }

    // push each gen_{type}(type_item) to convert_list
    const gen = converter['gen_' + type];
    assert.equal(typeof gen, 'function', 'innal error');
    convert_list.push(...gen(conf_list[type]));
  });
  convert_list.push(gen_symbols(CPUs)); // symbols converter
  return [copy_list, convert_list];
}

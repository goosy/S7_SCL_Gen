import { readdir } from 'fs/promises';
import { build_symbols, add_symbols, gen_symbols, BUILDIN_SYMBOLS } from './symbols.js';
import { IntIncHL, S7IncHL, context, write_file } from './util.js';
import { GCL } from './gcl.js';
import { globby } from 'globby';
import { posix } from 'path';
import { supported_types, supported_platforms, supported_categorys, converter } from './converter.js';
import assert from 'assert/strict';

/** @type {string: {CPU, includes, files, list, options}[] }*/
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
      // platform, 由CPU文档设置，默认 'step7'
      // device, 由CPU文档设置
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
      buildin_symbols: BUILDIN_SYMBOLS.documents.map(doc =>
        doc.get('symbols').items.map(symbol => symbol.items[0].value)
      ).flat(),                       // 该CPU的内置符号名称列表
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
 * 加载指定文档
 * 生命周期为第一遍扫描，主要功能是提取符号
 * @date 2022-07-03
 * @param {import('yaml').Document} doc
 */
async function add_conf(doc) {
  // 检查
  const CPU = CPUs.get(doc.CPU);
  const type = supported_types.find(t => converter[t].is_type(doc.type));
  if (type === 'CPU') {
    CPU.device = doc.get('device');
    const platform = doc.get('platform')?.toLowerCase() ?? 'step7';
    if (!supported_platforms.includes(platform)) {
      console.error(`"${doc.gcl.file}"文件的 CPU(${doc.CPU}) 配置平台 ${platform} 不支持`);
      process.exit(2);
    }
    CPU.platform = platform;
  }
  CPU.platform ??= 'step7'; // 没有CPU配置的情况设置默认平台
  if (CPU[type]) {
    console.error(`"${doc.gcl.file}"文件的配置 (${doc.CPU}-${type}) 已存在`);
    process.exit(2);
  }
  if (!supported_categorys[type].includes(CPU.platform)) {
    console.error(`${doc.gcl.file}文件 ${doc.CPU}:${CPU.platform}:${doc.type} 文档的转换类别不支持`);
    return;
  }

  // 按类型压入文档至CPU
  CPU.add_type(type, doc);

  // conf 存在属性为 null 但不是 undefined 的情况，故不能解构赋值
  const conf = doc.toJS();
  const options = conf.options ?? {};
  const list = conf.list ?? [];
  const files = conf.files ?? [];
  const { code: loop_additional_code, gcl_list: _ } = await parse_includes(conf.loop_additional_code, { CPU: CPU.name, type: type });
  const { code: includes, gcl_list } = await parse_includes(conf.includes, { CPU: CPU.name, type: type });

  // 加入内置符号
  for (const gcl of gcl_list) {
    for (const doc of gcl.documents) {
      const symbols = doc.get('symbols');
      // 将包含文件的符号扩展到内置符号列表
      CPU.buildin_symbols.push(...symbols.items.map(symbol => symbol.items[0].value));
      add_symbols(CPU, symbols ?? [], { document: doc });
    }
  }
  const buildin_doc = BUILDIN_SYMBOLS[type];
  if (buildin_doc) add_symbols(CPU, buildin_doc.get('symbols'), { document: buildin_doc });

  // 加入前置符号
  const symbols_node = doc.get('symbols');
  if (symbols_node) add_symbols(CPU, symbols_node, { document: doc });

  const area = { CPU, list, includes, files, loop_additional_code, options, gcl: doc.gcl };
  const parse_symbols = converter[type].parse_symbols;
  if (typeof parse_symbols === 'function') parse_symbols(area);
  conf_list[type].push(area);
}

export async function gen_data({ output_zyml, noconvert, silent } = {}) {
  const work_path = context.work_path;

  // 第一遍扫描 加载配置\提取符号\建立诊断信息
  try {
    silent || console.log('readding file:');
    const docs = [];
    for (const file of await readdir(work_path)) {
      if (/^.*\.ya?ml$/i.test(file)) {
        const filename = posix.join(work_path, file);
        const gcl = new GCL();
        await gcl.load(filename);
        for (const doc of gcl.documents) {
          // 确保CPU优先处理
          if (doc.type === 'CPU') docs.unshift(doc);
          else docs.push(doc);
        }
        silent || console.log(`\t${filename}`);
      }
    }
    for (const doc of docs) {
      await add_conf(doc);
    }
  } catch (e) {
    console.log(e);
  }

  // 第二遍扫描 补全数据

  // 检查并补全符号表
  for (const CPU of Object.values(CPUs)) {
    build_symbols(CPU);
  }

  for (const [type, list] of Object.entries(conf_list)) {
    const build = converter[type].build;
    if (typeof build === 'function') list.forEach(build);
  };

  // 校验完毕，由 noconvert 变量决定是否输出
  if (noconvert) return [[], []];

  // 输出无注释配置
  if (output_zyml) {
    console.log('output the uncommented configuration file:');
    const options = {
      commentString() { return ''; }, //注释选项
      indentSeq: false                //列表是否缩进
    }
    for (const [name, CPU] of Object.entries(CPUs)) {
      // 生成无注释的配置
      const yaml = supported_types.reduce(
        (docs, type) => CPU[type] ? `${docs}\n\n${CPU[type].toString(options)}` : docs,
        `# CPU ${name} configuration`
      );
      const filename = `${posix.join(work_path, CPU.output_dir, name)}.zyml`;
      await write_file(filename, yaml);
      console.log(`\t${filename}`);
    }
  }

  // 第三遍扫描 生成最终待转换数据
  const copy_list = [];
  const convert_list = [];
  for (const type of supported_types) {
    for (const item of conf_list[type]) {
      const output_dir = posix.join(work_path, item.CPU.output_dir);
      const gen_copy_list = converter[type].gen_copy_list;
      assert.equal(typeof gen_copy_list, 'function', `innal error: gen_${type}_copy_list`);
      const conf_files = [];
      for (const file of item.files) {
        if (/\\/.test(file)) throw new SyntaxError('路径分隔符要使用"/"!');
        let [base, rest] = file.split('//');
        if (rest == undefined) {
          rest = base;
          base = '';
        }
        base = posix.join(work_path, base);
        for (const src of await globby(posix.join(base, rest))) {
          const dst = src.replace(base, output_dir);
          conf_files.push({ src, dst });
        }
      };
      const ret = gen_copy_list(item);
      assert(Array.isArray(ret), `innal error: gen_${type}_copy_list(${item}) is not a Array`);
      copy_list.push(...conf_files, ...ret);
    }

    // push each gen_{type}(type_item) to convert_list
    const gen = converter[type].gen;
    assert.equal(typeof gen, 'function', 'innal error');
    convert_list.push(...gen(conf_list[type]));
  };
  convert_list.push(gen_symbols(CPUs)); // symbols converter
  return [copy_list, convert_list];
}

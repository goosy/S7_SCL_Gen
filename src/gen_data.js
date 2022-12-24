import assert from 'assert/strict';
import { readdir } from 'fs/promises';
import { globby } from 'globby';
import { posix } from 'path';
import { convert } from 'gooconverter';
import { supported_features, supported_platforms, supported_categorys, converter } from './converter.js';
import { GCL } from './gcl.js';
import { build_symbols, add_symbols, gen_symbols, BUILDIN_SYMBOLS } from './symbols.js';
import { IntIncHL, S7IncHL, context, write_file } from './util.js';

/** @type {string: {CPU, includes, files, list, options}[] }*/
const conf_list = {};
supported_features.forEach(feature => {
  // 初始化conf_list
  conf_list[feature] = [];
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
      add_feature(feature, document) {      // 按类型压入Document
        this[feature] = document;
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
  const filenames = includes ? JSON.parse(includes) : [];
  if (!Array.isArray(filenames)) return { code, gcl_list };
  try {
    for (const filename of filenames) {
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
 * @param {import('yaml').Document} document
 */
async function add_conf(document) {
  if (typeof document.feature != 'string') {
    console.error(`${document.gcl.file} 文件的 feature 必须提供，并且必须是字符串!`);
    return;
  }
  const feature = supported_features.find(_feature => converter[_feature].is_feature(document.feature));
  if (!feature) {
    console.error(`不支持 ${document.gcl.file} 文件的 ${document.feature} 功能转换!`);
    return;
  }
  const platform = document.get('platform')?.toLowerCase();
  if (platform && !supported_platforms.includes(platform)) {
    console.error(`不支持 ${document.gcl.file} 文件 ${feature} 转换功能要求的 ${platform} 平台`);
    return;
  }
  const options = { filename: 'buildin', CPU: document.CPUs, feature };
  const { code: loop_additional_code, gcl_list: _ } = await parse_includes(document.get('loop_additional_code'), options);
  const { code: includes, gcl_list } = await parse_includes(document.get('includes'), options);

  // 内置符号文档
  const buildin_doc = BUILDIN_SYMBOLS[feature];
  const symbols_of_buildin = buildin_doc ? buildin_doc.get('symbols').items : [];
  // 包含文件符号 [YAMLSeq symbol]
  const symbols_of_includes = gcl_list.map(
    gcl => gcl.documents.map(
      doc => doc.get('symbols').items
    )
  ).flat(2);
  // 文档前置符号
  const symbols_of_doc = document.get('symbols')?.items ?? [];

  // CPU
  for (const _CPU of document.CPUs) {
    // 检查
    assert.equal(typeof _CPU, 'string', new SyntaxError(`"${document.gcl.file}"文件的 name 或者 CPU 必须提供，并且必须是字符串或字符串数组!`));
    const CPU = CPUs.get(_CPU);
    if (CPU[feature]) {
      console.error(`"${document.gcl.file}"文件的配置 (${document.CPU}-${feature}) 已存在`);
      process.exit(2);
    }
    CPU.platform ??= platform ?? 'step7'; // 没有CPU配置情况的默认平台
    if (platform && CPU.platform != platform) {
      console.error(
        `${document.gcl.file} 文件：
        ${feature} 功能要求的 ${platform} 平台与该CPU下其它文档冲突
        建议删除 platform 指令，并统一在CPU文档中设置!`
      );
      return;
    }
    if (!supported_categorys[feature].includes(CPU.platform)) {
      console.error(`文件:"${document.gcl.file}" 文档:[${document.CPUs.join(',')}]:${document.feature} 的转换功能不支持`);
      return; // 剩余的CPU也一定不满足条件
    }
    // 按类型压入文档至CPU
    CPU.add_feature(feature, document);

    // 压入内置符号
    // 将包含文件的符号扩展到内置符号名称列表
    CPU.buildin_symbols.push(...symbols_of_includes.map(
      symbol => symbol.items[0].value
    ));
    add_symbols(CPU, symbols_of_includes, { document })
    add_symbols(CPU, symbols_of_buildin, { document: buildin_doc });

    // 加入前置符号
    if (symbols_of_doc) add_symbols(CPU, symbols_of_doc, { document });

    // conf 存在属性为 null 但不是 undefined 的情况，故不能解构赋值
    const conf = document.toJS();
    const list = conf.list ?? [];
    const files = conf.files ?? [];
    const options = conf.options ?? {};
    const name = CPU.name;
    if (options.output_file) options.output_file = convert({ name, CPU: name }, options.output_file);
    const area = { CPU, list, includes, files, loop_additional_code, options, gcl: document.gcl };
    const parse_symbols = converter[feature].parse_symbols;
    if (typeof parse_symbols === 'function') parse_symbols(area);
    conf_list[feature].push(area);
  }
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
          if (doc.feature === 'CPU') docs.unshift(doc);
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

  for (const [feature, list] of Object.entries(conf_list)) {
    const build = converter[feature].build;
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
      const yaml = supported_features.reduce(
        (docs, feature) => CPU[feature] ? `${docs}\n\n${CPU[feature].toString(options)}` : docs,
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
  for (const feature of supported_features) {
    for (const item of conf_list[feature]) {
      const output_dir = posix.join(work_path, item.CPU.output_dir);
      const gen_copy_list = converter[feature].gen_copy_list;
      assert.equal(typeof gen_copy_list, 'function', `innal error: gen_${feature}_copy_list`);
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
      assert(Array.isArray(ret), `innal error: gen_${feature}_copy_list(${item}) is not a Array`);
      copy_list.push(...conf_files, ...ret);
    }

    // push each gen_{feature}(feature_item) to convert_list
    const gen = converter[feature].gen;
    assert.equal(typeof gen, 'function', 'innal error');
    convert_list.push(...gen(conf_list[feature]));
  };
  convert_list.push(gen_symbols(CPUs)); // symbols converter
  return [copy_list, convert_list];
}

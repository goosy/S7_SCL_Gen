import assert from 'assert/strict';
import { readdir } from 'fs/promises';
import { globby } from 'globby';
import { posix } from 'path';
import { convert } from 'gooconverter';
import { supported_features, converter } from './converter.js';
import { GCL } from './gcl.js';
import { add_symbols, build_symbols, gen_symbols, BUILDIN_SYMBOLS, NONSYMBOLS, WRONGTYPESYMBOLS, LAZYASSIGN_LIST } from './symbols.js';
import { IntIncHL, S7IncHL, context, write_file } from './util.js';
import { pad_right } from "./value.js";

/** 
 * @typeof {object} Area 
 * @property {import('yaml').Document} document - 文档
 * @property {Array} list - 列表
 * @property {string|string[]} includes - 包括列表
 * @property {string[]} files - 文件列表
 * @property {object} options - 选项
 */

/** @type {object.<string, Area[]>}*/
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
      SFB_list: new IntIncHL(256),    // 已用系统函数块列表
      SFC_list: new IntIncHL(256),    // 已用系统函数列表
      UDT_list: new IntIncHL(256),    // 已用自定义类型列表
      MA_list: new S7IncHL([0, 0]),   // 已用M地址
      IA_list: new S7IncHL([0, 0]),   // 已用I地址
      QA_list: new S7IncHL([0, 0]),   // 已用Q地址
      PIA_list: new S7IncHL([0, 0]),  // 已用PI地址
      PQA_list: new S7IncHL([0, 0]),  // 已用PQ地址
      symbols_dict: {},               // 符号字典
      buildin_symbols:                // 该CPU的内置符号名称列表
        BUILDIN_SYMBOLS.documents.map(doc =>
          doc.get('symbols').items.map(symbol => symbol.items[0].value)
        ).flat(),
      conn_host_list: {},             // 已用的连接地址列表
      output_dir: CPU_name,           // 输出文件夹
      add_feature(feature, document) {// 按功能压入Document
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
  const filenames = includes ? includes.toJSON() : [];
  if (!Array.isArray(filenames)) return { code, gcl_list };
  try {
    for (const filename of filenames) {
      const gcl = new GCL();
      await gcl.load(filename, { ...options, encoding: 'utf8', inSCL: true });
      gcl_list.push(gcl);
    };
    code = gcl_list.map(gcl => gcl.SCL).join('\n\n');
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
  // feature
  const feature = supported_features.find(name => converter[name].is_feature(document.feature));
  if (!feature) {
    console.error(`不支持 ${document.gcl.file} 文件的 ${document.feature} 功能转换!`);
    return;
  }

  // CPU
  const CPU = document.CPU;
  if (CPU[feature]) {
    console.error(`"${document.gcl.file}"文件的配置 (${document.CPU}-${feature}) 已存在`);
    process.exit(2);
  }
  // 按类型压入文档至CPU
  CPU.add_feature(feature, document);

  // platform
  // valid only in CPU documentation
  const platform = feature === 'CPU'
    ? document.get('platform')?.toLowerCase() ?? 'step7'
    : undefined;
  if (platform && !converter[feature].platforms.includes(platform)) {
    console.error(`文件:"${document.gcl.file}" 文档:[${document.CPU}] 不支持${platform}平台的${feature}转换功能`);
    return;
  }
  CPU.platform ??= platform;

  // external code
  const includes_options = { CPU: CPU.name, feature };
  const {
    code: loop_additional_code,
    gcl_list: _
  } = await parse_includes(document.get('loop_additional_code'), includes_options);
  const {
    code: includes,
    gcl_list: includes_gcls
  } = await parse_includes(document.get('includes'), includes_options);

  // 包含文件符号 [YAMLSeq symbol]
  includes_gcls.forEach(gcl => {
    gcl.documents.forEach(doc => {
      doc.CPU = CPU;
      const symbols_of_includes = add_symbols(doc, doc.get('symbols')?.items ?? []);
      CPU.buildin_symbols.push(...symbols_of_includes.map(symbol => symbol.name)); // 将包含文件的符号扩展到内置符号名称列表
    })
  });
  // 内置符号文档
  const buildin_doc = BUILDIN_SYMBOLS.documents.find(doc => doc.feature === feature).clone();
  buildin_doc.CPU = CPU;
  buildin_doc.gcl = BUILDIN_SYMBOLS;
  add_symbols(buildin_doc, buildin_doc ? buildin_doc.get('symbols').items : []);

  // 文档前置符号
  const raw_symbols_of_doc = document.get('symbols')?.items ?? [];
  if (raw_symbols_of_doc) add_symbols(document, raw_symbols_of_doc,);

  // 传递节点以便定位源码位置
  const list = document.get('list')?.items ?? [];
  const files = document.get('files')?.items ?? [];
  const options = document.get('options')?.toJSON() ?? {};
  const name = CPU.name;
  if (options.output_file) options.output_file = convert({ name, CPU: name }, options.output_file);
  const area = { document, list, includes, files, loop_additional_code, options };
  const initialize_list = converter[feature].initialize_list;
  if (typeof initialize_list === 'function') initialize_list(area);
  conf_list[feature].push(area);
}

export async function gen_data({ output_zyml, noconvert, silent } = {}) {
  const work_path = context.work_path;

  // 第一遍扫描 加载配置\提取符号\建立诊断信息
  try {
    silent || console.log('\nreadding GCL files: 读取配置文件：');
    const docs = [];
    for (const file of await readdir(work_path)) {
      if (/^.*\.ya?ml$/i.test(file)) {
        const filename = posix.join(work_path, file);
        const gcl = new GCL();
        await gcl.load(filename);
        for (const doc of gcl.documents) {
          doc.CPU = CPUs.get(doc.CPU);
          Object.defineProperty(doc, 'CPU', {
            enumerable: true,
            configurable: false,
          });
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
  LAZYASSIGN_LIST.forEach(fn => fn());

  for (const CPU of Object.values(CPUs)) {
    // the code below must run on all CPUs not just those with CPU document
    CPU.platform ??= 'step7';
    build_symbols(CPU);
  }

  for (const feature of supported_features) {
    const list = conf_list[feature];
    const build_list = converter[feature].build_list;
    if (typeof build_list === 'function') list.forEach(build_list);
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
      const output_dir = posix.join(work_path, item.document.CPU.output_dir);
      const gen_copy_list = converter[feature].gen_copy_list;
      assert.equal(typeof gen_copy_list, 'function', `innal error: gen_${feature}_copy_list`);
      const conf_files = [];
      for (const file of item.files) {
        if (/\\/.test(file.value)) throw new SyntaxError('路径分隔符要使用"/"!');
        let [base, rest] = file.value.split('//');
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
  convert_list.push(gen_symbols(Object.values(CPUs))); // symbols converter

  // 非符号提示
  if (NONSYMBOLS.length) console.log(`
warning: 警告：
The following values isn't a symbol in GCL file. 配置文件中以下符号值无法解析成S7符号
The converter treats them as S7 expressions without checking validity. 转换器将它们视为S7表达式不检验有效性
Please make sure they are legal and valid S7 expressions. 请确保它们是合法有效的S7表达式`
  );
  NONSYMBOLS.forEach(item => {
    console.log(`\t${pad_right(item.prop, 18)}: ${item.value}`);
  });
  // 用户符号类型定义错误提示
  if (WRONGTYPESYMBOLS.size) console.log(`
warning: 警告：
The user defined type of following symbols is wrong. 配置文件中以下符号用户定义的类型有误
The converter convert them to the correct type . 转换器将它们转换为合法有效的类型`
  );
  WRONGTYPESYMBOLS.forEach(symbol => {
    console.log(`\t${symbol.name}:  'user defined type: ${symbol.userDefinedType}'  'actual type: ${symbol.type}'`);
  });

  return [copy_list, convert_list];
}

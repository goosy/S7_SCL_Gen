import assert from 'assert/strict';
import { readdir } from 'fs/promises';
import { globby } from 'globby';
import { posix } from 'path';
import { convert } from 'gooconverter';
import { supported_features, converter } from './converter.js';
import { GCL, get_Seq } from './gcl.js';
import {
    add_symbols, gen_symbols,
    BUILDIN_SYMBOLS, NON_SYMBOLS, WRONGTYPESYMBOLS,
    S7SymbolEmitter,
    SYMBOL_PROMISES,
} from './symbols.js';
import { gen_alarms } from './alarms.js';
import { IntIncHL, context, write_file } from './util.js';
import { pad_right, nullable_value, STRING } from "./value.js";

/**
 * @typedef {import('yaml').Document} Document - YAML Document
 */

/**
 * @typedef  {object} Area
 * @property {Document} document - 文档
 * @property {Array} list - 列表
 * @property {string|string[]} includes - 包括列表
 * @property {string[]} files - 文件列表
 * @property {object} options - 选项
 */

/**
 * @typedef  {object} CPU
 * @property {string} name - CPU name
 * @property {string} platform - 由CPU文档设置，默认 'step7'
 * @property {string} device - 由CPU文档设置
 * @property {IntIncHL} conn_ID_list - 已用连接ID列表
 * @property {S7SymbolEmitter} symbols - 符号调度中心
 * @property {object} conn_host_list - 已用的连接地址列表
 * @property {string} output_dir - 输出文件夹
 * @function
 * @name CPU#add_feature
 * @param {string} feature - 功能名称
 * @param {Document} document - 配置文档
 * @returns {void}
 */

/** @type {object.<string, Area[]>}*/
const conf_list = {};
supported_features.forEach(feature => {
    // 初始化conf_list
    conf_list[feature] = [];
});

const CPUs = {
    /**
     * 按照名称建立一个新CPU
     * @param {string} name
     * @returns {CPU}
     */
    create(name) {
        return {
            name,
            // platform, 由CPU文档设置，默认 'step7'
            // device, 由CPU文档设置
            symbols: new S7SymbolEmitter(), // 符号调度中心
            conn_ID_list: new IntIncHL(16), // 已用连接ID列表
            conn_host_list: {},             // 已用的连接地址列表
            alarms_list: [],                // 该CPU的报警列表
            output_dir: name,               // 输出文件夹
            /**
             * Description
             * @param {string} feature
             * @param {Document} document
             * @returns {void}
             */
            add_feature(feature, document) {// 按功能压入Document
                this[feature] = document;
            }
        };
    },
    /**
     * 按照名称返回一个CPU，如果该名称CPU不存在，就产生一个新CPU
     * @param {string} name
     * @returns {CPU}
     */
    get(name) {
        // 从已有CPU中找，如没有则建立一个初始CPU资源数据
        return CPUs[name] ??= CPUs.create(name);
    },
};

async function parse_includes(includes, options) {
    let gcl_list = [], code = '';
    if (typeof includes == 'string') return { code: includes, gcl_list };
    const filenames = includes ? includes.toJSON() : [];
    if (!Array.isArray(filenames)) return { code, gcl_list };
    try {
        const work_path = context.work_path;
        for (const filename of filenames) {
            const gcl = new GCL();
            await gcl.load(
                posix.join(work_path, filename),
                { ...options, encoding: 'utf8', inSCL: true }
            );
            gcl_list.push(gcl);
        };
        code = gcl_list.map(gcl => gcl.SCL).join('\n\n');
    } catch (err) {
        code = '';
        console.error(err.message);
    }
    return { code, gcl_list };
}

async function create_CPU_doc(CPU) {
    // create a blank CPU document for CPU
    const gcl = new GCL();
    const yaml = `name: ${CPU.name}-CPU\nplatform: step7\nsymbols:[]\nlist: []`;
    await gcl.load(yaml, { isFile: false });
    const doc = gcl.documents[0];
    Object.defineProperty(doc, 'CPU', {
        value: CPU,
        writable: false,
        enumerable: true,
        configurable: false,
    });
    return doc;
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
        console.error(`warning: 警告：
        info 信息: Don't support ${feature} feature. 不支持 ${document.feature} 功能转换|
        file 文件:"${document.gcl.file}"
        The conversion of this feature will be skipped 将跳过该转换功能s`);
        return;
    }
    const _converter = converter[feature];

    // CPU
    const CPU = document.CPU;
    if (feature !== 'CPU' && CPU.CPU == null) {
        // create a blank CPU document if CPU.CPU desn't exist
        const doc = await create_CPU_doc(CPU);
        add_conf(doc);
    }
    if (CPU[feature]) {
        console.error(`configuration ${CPU.name}-${feature} is duplicated. 配置 ${CPU.name}-${feature} 重复存在!
        previous file 上一文件: ${CPU[feature].gcl.file}
        current file  当前文件: ${document.gcl.file}
        Please correct and convert again. 请更正后重新转换。`);
        process.exit(2);
    }
    // 按类型压入文档至CPU
    CPU.add_feature(feature, document);

    // platform
    if (feature === 'CPU') {
        // valid only in CPU documentation
        CPU.platform = document.get('platform')?.toLowerCase() ?? 'step7';
    } else if (document.get('platform') != null) {
        console.error(`warning: 警告：
        info 信息: Non-CPU documentation should not indicate platform. 非 CPU 文档不应指示platform
        file 文件:"${document.gcl.file}"
        doc 文档:${feature}`);
    }
    if (!_converter.platforms.includes(CPU.platform)) {
        console.error(`warning: 警告：
        info 信息: ${CPU.platform} platform don't support ${feature} feature. 不支持${CPU.platform}平台的${feature}转换功能
        file 文件:"${document.gcl.file}"
        doc 文档:${feature}
        The conversion of this feature will be skipped 将跳过该转换功能`);
        return;
    }

    // external code
    const loop_begin = nullable_value(STRING, document.get('loop_begin'))?.value;
    const loop_end = nullable_value(STRING, document.get('loop_end'))?.value;
    const {
        code: includes,
        gcl_list,
    } = await parse_includes(document.get('includes'), { CPU: CPU.name, feature });

    // 包含文件符号 [YAMLSeq symbol]
    gcl_list.forEach(gcl => {
        gcl.documents.forEach(doc => {
            doc.CPU = CPU;
            const symbols_of_includes = add_symbols(doc, get_Seq(doc, 'symbols'));
            CPU.symbols.push_buildin(...symbols_of_includes.map(symbol => symbol.name)); // 将包含文件的符号扩展到内置符号名称列表
        })
    });
    // 内置符号文档
    const buildin_doc = BUILDIN_SYMBOLS.documents.find(doc => doc.feature === feature).clone();
    buildin_doc.CPU = CPU;
    buildin_doc.gcl = BUILDIN_SYMBOLS;
    add_symbols(
        buildin_doc,
        get_Seq(buildin_doc, 'symbols')
    );

    // 符号引用
    if (feature === 'CPU') {
        [
            // 内置引用
            ...add_symbols(
                buildin_doc,
                get_Seq(buildin_doc, 'reference_symbols')
            ),
            // 前置引用
            ...add_symbols(
                document,
                get_Seq(document, 'reference_symbols')
            ),
        ].forEach(symbol => { // 所有引用符号不导出
            symbol.exportable = false
        });
    }

    // 文档前置符号
    add_symbols(
        document,
        get_Seq(document, 'symbols')
    );

    // 传递节点以便定位源码位置
    const list = document.get('list')?.items ?? [];
    const files = document.get('files')?.items ?? [];
    const options = document.get('options')?.toJSON() ?? {};
    const name = CPU.name;
    if (options.output_file) options.output_file = convert({ name, CPU: name }, options.output_file);
    const area = { document, list, includes, files, loop_begin, loop_end, options };
    // 将 area.list 的每一项由 YAMLNode 转换为可供模板使用的数据对象
    _converter.initialize_list(area);
    conf_list[feature].push(area);
}

export async function gen_data({ output_zyml, noconvert, silent } = {}) {
    const work_path = context.work_path;
    const docs = [];
    const cpus = [];

    // 第一遍扫描 加载配置\提取符号\建立诊断信息
    try {
        silent || console.log('\nreadding GCL files: 读取配置文件：');
        for (const file of await readdir(work_path)) {
            if (/^.*\.ya?ml$/i.test(file)) {
                const filename = posix.join(work_path, file);
                const gcl = new GCL();
                await gcl.load(filename);
                for (const doc of gcl.documents) {
                    let CPU = CPUs[doc.CPU];
                    if (!CPU) {
                        CPU = CPUs.get(doc.CPU);
                        cpus.push(CPU);
                    }
                    Object.defineProperty(doc, 'CPU', {
                        value: CPU,
                        writable: false,
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
        for (const CPU of cpus) {
            CPU.symbols.emit('finished');
            // complete the symbol
        }
    } catch (e) {
        console.log(e);
    }
    await Promise.all(SYMBOL_PROMISES);

    // 第二遍扫描 补全数据

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
        for (const CPU of cpus) {
            const name = CPU.name;
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
    convert_list.push(
        gen_symbols(cpus), // symbols converter
        gen_alarms(cpus) // alarms converter
    );

    // 非符号提示
    if (NON_SYMBOLS.length) console.log(`
warning: 警告：
The following values isn't a symbol in GCL file. 配置文件中以下符号值无法解析成S7符号
The converter treats them as S7 expressions without checking validity. 转换器将它们视为S7表达式不检验有效性
Please make sure they are legal and valid S7 expressions. 请确保它们是合法有效的S7表达式`
    );
    NON_SYMBOLS.forEach(({ value, desc }) => {
        console.log(`\t${pad_right(value, 24)}: ${desc}`);
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

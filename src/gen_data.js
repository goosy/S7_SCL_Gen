import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { globby } from 'globby';
import { convert } from 'gooconverter';
import { isMap } from 'yaml';
import { supported_features, converter } from './converter.js';
import { GCL, get_Seq, isString } from './gcl.js';
import {
    add_symbols, gen_symbols, S7SymbolEmitter,
    BUILDIN_SYMBOLS, WRONGTYPESYMBOLS,
} from './symbols.js';
import { gen_alarms } from './alarms.js';
import {
    context, get_template,
    read_file, write_file,
    pad_left, pad_right, fixed_hex, elog
} from './util.js';
import { nullable_value, STRING, IntHashList } from "./s7data.js";

/**
 * @typedef {import('yaml').Document} Document - YAML Document
 */

/**
 * @typedef {object} Area
 * @property {Document} document
 * @property {Array} list
 * @property {object} attributes custom attributes
 * @property {string|string[]} includes custom SCL code or files list to include into the final generated code
 * @property {string[]} files files to be copied list
 * @property {string} loop_begin custom SCL at the beginning of the loop
 * @property {string} loop_end custom SCL at the end of the loop
 * @property {object} options options
 */

/**
 * @typedef {Object} NonSymbol
 * @property {string} value - 符号表达式
 * @property {string} desc - 错误描述
 */

class CPU {
    /** @type {string} */
    name;                             // CPU 名称
    /** @type {string} */
    platform;                         // 由CPU文档设置，默认 'step7'
    /** @type {string} */
    device;                           // 由CPU文档设置

    #areas = {};              // 该CPU的功能区
    /**
     * Retrieves the specified feature area from the CPU.
     *
     * @param {string} feature -  name of the feature
     * @return {Area|null} the specified feature from the feature areas
     */
    get_area(feature) {
        return this.#areas[feature];
    }
    /**
     * Set the feature area to the CPU.
     *
     * @param {string} feature - name of the feature
     * @param {Area} area - value of the area
     * @return {void}
     */
    set_area(feature, area) {
        if (this.#areas[feature]) {
            throw new Error(`feature ${feature} of the CPU ${this.name} is already defined`);
        }
        this.#areas[feature] = area;
    }
    /**
     * Returns an array of area in the CPU.
     *
     * @return {[string,Area][]} An array containing all the area in the CPU.
     */
    get areas() {
        return Object.entries(this.#areas);
    }

    /** @type {string} */
    output_dir;                       // 输出文件夹

    /** @type {S7SymbolEmitter} */
    symbols = new S7SymbolEmitter();  // 符号调度中心
    /** @type {Promise.<S7Symbol>[]} */
    async_symbols = [];               // 该CPU的异步符号列表
    /** @type {NonSymbol[]} */
    non_symbols = [];                 // 该CPU的非符号列表.push({ value, desc: s7_expr_desc });

    /** @type {IntHashList} */
    conn_ID_list = new IntHashList(16); // 已用连接ID列表
    /** @type {Object.<string, number>} */
    conn_host_list = {};             // 已用的连接地址列表
    /**
     * @type { {
     *   tagname: string,
     *   location: string,
     *   event: string,
     *   PV1: string
     * } }
     */
    alarms_list = [];                // 该CPU的报警列表

    constructor(name) {
        this.name = name;
        this.output_dir = name;
    }
}

const CPUs = {
    /**
     * 按照名称返回一个CPU，如果该名称CPU不存在，就产生一个新CPU
     * @param {string} name
     * @returns {CPU}
     */
    get_or_create(name) {
        // 从已有CPU中找，如没有则建立一个初始CPU资源数据
        return CPUs[name] ??= new CPU(name);
    },
};


/**
 * Parses YAML commented SCL strings and remove `(** **)` comment
 *
 * @param {string} str - the SCL string with `(** **)` comment
 * @return {{scl: string, error: SyntaxError | null}} an object containing the parsed SCL
 */
function parse_SCL(str) {
    let scl = '';
    let in_comment = false;
    let start = 0;
    const line_ends = [
        ...str.matchAll(/\r\n|\n|\r/g),
        { index: str.length },
    ].map(match => match.index);
    const error = new SyntaxError(`SCL文件出错: (** 或 **) 必须在一行的开头，行尾只能有空格，并且必须成对出现。`);
    const error_result = { scl, error };

    // SCL中只能用注释进行符号定义
    for (const end of line_ends) {
        const line = str.substring(start, end);
        const head = line.replace(/\n|\r/g, '').substring(0, 3);
        const on_start = head === '(**';
        const on_end = head === '**)';

        if (on_start) {
            if (in_comment || line.trim() !== '(**') return error_result;
            in_comment = true;
        } else if (on_end) {
            if (!in_comment || line.trim() !== '**)') return error_result;
            in_comment = false;
        } else if (!in_comment) {
            scl += line;
        }
        start = end;
    }
    scl = scl.trim();
    return { scl, error: null };
}

async function parse_includes(includes, options) {
    if (typeof includes == 'string') return includes;
    const filenames = includes ? includes.toJSON() : [];
    let code = [];
    if (!Array.isArray(filenames)) return '';
    for (const file of filenames) {
        const filename = typeof file === 'string' ? file : file.filename;
        const encoding = file.encoding ?? 'utf8';
        const content = await read_file(posix.join(context.work_path, filename), { encoding });
        const tags = { ...options, encoding };
        const { scl, error } = parse_SCL(content);
        if (error) {
            console.error(err.message);
            return '';
        };
        code.push(convert(tags, scl)); // subsitute tags in SCL
    };
    return code.join('\n\n');
}

async function create_fake_CPU_doc(CPU) {
    // create a blank CPU document for CPU
    const yaml = `name: ${CPU.name}-CPU\nplatform: step7\nsymbols:[]\nlist: []`;
    const gcl = new GCL(yaml);
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
async function parse_doc(document) {
    // feature
    const feature = supported_features.find(name => converter[name].is_feature(document.feature));
    if (!feature) {
        console.error(`warning: 警告：
        info 信息: Don't support ${feature} feature. 不支持 ${document.feature} 功能转换|
        file 文件:"${document.gcl.file}"
        The conversion of this feature will be skipped 将跳过该转换功能s`);
        return;
    } else if (feature !== document.feature) {
        Object.defineProperty(document, 'feature', {
            get() {
                return feature;
            },
            enumerable: true,
            configurable: false,
        });
    }
    const _converter = converter[feature];

    /** @type {CPU} */
    const cpu = document.CPU;
    if (feature !== 'CPU' && cpu.get_area('CPU') == null) {
        // create a blank CPU document if CPU area desn't exist
        const doc = await create_fake_CPU_doc(cpu);
        parse_doc(doc);
    }
    if (cpu.get_area(feature)) {
        console.error(`configuration ${cpu.name}-${feature} is duplicated. 配置 ${cpu.name}-${feature} 重复存在!
        previous file 上一文件: ${cpu.get_area(feature).document.gcl.file}
        current file  当前文件: ${document.gcl.file}
        Please correct and convert again. 请更正后重新转换。`);
        process.exit(2);
    }

    // platform
    if (feature === 'CPU') {
        // valid only in CPU documentation
        cpu.platform = document.get('platform')?.toLowerCase() ?? 'step7';
    } else if (document.get('platform') != null) {
        console.error(`warning: 警告：
        info 信息: Non-CPU documentation should not indicate platform. 非 CPU 文档不应指示platform
        file 文件:"${document.gcl.file}"
        doc 文档:${feature}`);
    }
    if (!_converter.platforms.includes(cpu.platform)) {
        console.error(`warning: 警告：
        info 信息: ${cpu.platform} platform don't support ${feature} feature. 不支持${cpu.platform}平台的${feature}转换功能
        file 文件:"${document.gcl.file}"
        doc 文档:${feature}
        The conversion of this feature will be skipped 将跳过该转换功能`);
        return;
    }

    // external code8
    const attributes_node = document.get('attributes');
    if (attributes_node && !isMap(attributes_node)) {
        throw new Error('attributes must be a Map! 属性必须为对象');
    }
    const attributes = attributes_node?.toJSON() ?? {};
    const loop_begin = nullable_value(STRING, document.get('loop_begin'))?.value;
    const loop_end = nullable_value(STRING, document.get('loop_end'))?.value;
    const includes = await parse_includes(document.get('includes'), {
        ...attributes,
        cpu_name: cpu.name, feature,
        platform: cpu.platform,
    });

    // 内置符号文档
    const buildin_doc = BUILDIN_SYMBOLS.documents.find(doc => doc.feature === feature).clone();
    buildin_doc.CPU = cpu;
    buildin_doc.gcl = BUILDIN_SYMBOLS;
    add_symbols(
        buildin_doc,
        get_Seq(buildin_doc, 'symbols')
    );

    // 符号引用 (在符号表中不导出)
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
        ].forEach(symbol => {
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
    const files = (document.get('files')?.items ?? []).map(
        item => isString(item) ? item.value : item.toJSON()
    );
    const options = document.get('options')?.toJSON() ?? {};
    const cpu_name = cpu.name;
    if (options.output_file) {
        options.output_file = convert({ cpu_name }, options.output_file);
    }
    /** @type Area */
    const area = {
        document, attributes,
        includes, files, list, loop_begin, loop_end,
        options
    };
    // 按类型压入文档至CPU
    cpu.set_area(feature, area);
    // 将 area.list 的每一项由 YAMLNode 转换为可供模板使用的数据对象
    _converter.initialize_list(area);
}

async function parse_conf() {
    const docs = [];
    const cpu_list = [];
    const work_path = context.work_path;
    const silent = context.silent;
    try {
        silent || console.log('\nreadding GCL files: 读取配置文件：');
        for (const file of await readdir(work_path)) {
            if (/^.*\.ya?ml$/i.test(file)) {
                const filename = posix.join(work_path, file);
                const gcl = await GCL.load(filename);
                for (const doc of gcl.documents) {
                    let cpu = CPUs[doc.cpu_name];
                    if (!cpu) {
                        cpu = CPUs.get_or_create(doc.cpu_name);
                        cpu_list.push(cpu);
                    }
                    Object.defineProperty(doc, 'CPU', {
                        value: cpu,
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
            await parse_doc(doc);
        }

        // wait for all symbols to complete
        cpu_list.forEach(cpu => cpu.symbols.emit('finished'));
        await Promise.all(cpu_list.map(cpu => cpu.async_symbols).flat());
    } catch (e) {
        console.log(e);
    }
    return cpu_list;
}

/**
 * @typedef {Object} CopyItem
 * @property {string} src the source file
 * @property {string} dst the distance file
 * @property {string|null} IE the encoding of the source file
 * @property {boolean} enable the enable of converting action or copying action
 * @property {string} CPU the name of the CPU
 * @property {string} feature
 * @property {string} platform
 * @property {string|null} content the file content
 * @property {string} OE the encoding of the distance file
 * @property {string} line_ending the line_ending of the distance file
 */

/**
 * @typedef {CopyItem[]} CopyList
 */

/**
 * @typedef {Object} ConvertItem
 * @property {object} tags the variables for substitution on the template
 * @property {string} template the template string
 * @property {string} dst the distance file
 * @property {boolean} enable the enable of converting action or copying action
 * @property {string} CPU the name of the CPU
 * @property {string} feature
 * @property {string} platform
 * @property {string|null} content the file content
 * @property {string} OE the encoding of the distance file
 * @property {string} line_ending the line_ending of the distance file
 */

/**
 * @typedef {ConvertItem[]} ConvertList
 */

/**
 * Generate copy and conversion lists based on the provided configuration.
 *
 * @param {Array.<CPU>} cpu_list - Array of CPU to process
 * @return {{copy_list: CopyList, convert_list: ConvertList}} Object containing the lists of files to copy and convert
 */
async function gen_list(cpu_list) {
    const work_path = context.work_path;
    /** @type CopyItem[] */
    const copy_list = [];
    /** @type ConvertItem[] */
    const convert_list = [];
    for (const cpu of cpu_list) {
        const { name: cpu_name, platform } = cpu;
        for (const [feature, area] of cpu.areas) {
            const output_dir = posix.join(work_path, cpu.output_dir);
            const common_options = {
                cpu_name,
                feature,
                platform,
                OE: context.OE,
                line_ending: context.line_ending,
                enable: true,
            }

            for (const file of area.files) {
                /** @type string | undinfied */
                const IE = file.IE;
                const line_ending = file.line_ending ?? context.line_ending;
                const OE = file.OE ?? context.OE;
                const is_filename = typeof file === 'string';
                const name = is_filename ? file : file.filename;
                if (/\\/.test(name)) elog(new SyntaxError('Use "/" as the path separator!'));
                let [dir, base] = name.split('//');
                if (base == undefined) {
                    base = posix.basename(name);
                    dir = posix.dirname(name);
                }
                dir = posix.join(work_path, dir);
                for (const filename of await globby(posix.join(dir, base))) {
                    copy_list.push({
                        ...common_options,
                        IE, src: filename,
                        OE, dst: filename.replace(dir, output_dir),
                        line_ending,
                    });
                }
            };

            const gcl = area.document.gcl;
            const gen_copy_list = converter[feature].gen_copy_list;
            assert.equal(typeof gen_copy_list, 'function', `innal error: gen_copy_list of ${feature} is not a function`);
            const f_copy_list = gen_copy_list(area).map(item => ({ ...common_options, ...item }));
            copy_list.push(...f_copy_list);

            // push each gen(area) to convert_list
            const gen = converter[feature].gen;
            assert.equal(typeof gen, 'function', `innal error: gen of ${feature} is not a function`);
            for (const item of gen(area)) {
                const dst = posix.join(work_path, item.path);
                const tags = { // 提供一些默认变量
                    context, gcl,
                    pad_left, pad_right, fixed_hex,
                    cpu_name, feature, platform,
                    ...area,
                    ...item.tags,
                }
                const template = await get_template(feature, item.template);
                convert_list.push({ ...common_options, tags, template, dst });
            };
        }
    };
    const symbols_list = gen_symbols(cpu_list);
    symbols_list.forEach(item => item.dst = posix.join(work_path, item.path));
    const alarms_list = gen_alarms(cpu_list);
    alarms_list.forEach(item => item.dst = posix.join(work_path, item.path));
    convert_list.push(...symbols_list, ...alarms_list);
    return { copy_list, convert_list };
}

export async function gen_data() {
    WRONGTYPESYMBOLS.clear();
    // 第一遍扫描 加载配置\提取符号\建立CPU及诊断信息
    const cpu_list = await parse_conf();

    // 第二遍扫描 补全数据
    // 非符号提示
    if (!context.silent && cpu_list.find(cpu => cpu.non_symbols.length)) {
        console.log(`
warning: 警告：
The following values isn't a symbol in GCL file. 配置文件中以下符号值无法解析成S7符号
The converter treats them as S7 expressions without checking validity. 转换器将它们视为S7表达式不检验有效性
Please make sure they are legal and valid S7 expressions. 请确保它们是合法有效的S7表达式`
        );
    }
    for (const cpu of cpu_list) {
        for (const [feature, area] of cpu.areas) {
            const build_list = converter[feature].build_list;
            if (typeof build_list === 'function') build_list(area);
        };
        const non_symbols = cpu.non_symbols;
        non_symbols.forEach(({ value, desc }) => {
            context.silent || console.log(`\t${pad_right(value, 24)}: ${desc}`); // 非符号提示
        });
    }

    // 用户符号类型定义错误提示，错误类型的符号不归于CPU
    if (!context.silent && WRONGTYPESYMBOLS.size) {
        console.log(`
warning: 警告：
The user defined type of following symbols is wrong. 配置文件中以下符号用户定义的类型有误
The converter convert them to the correct type . 转换器将它们转换为合法有效的类型`
        );
        WRONGTYPESYMBOLS.forEach(symbol => {
            console.log(`\t${symbol.name}:  'user defined type: ${symbol.userDefinedType}'  'actual type: ${symbol.type}'`);
        });
    }

    // 输出无注释配置
    if (context.output_zyml) {
        console.log('output the uncommented configuration file:');
        const options = {
            commentString() { return ''; }, //注释选项
            indentSeq: false                //列表是否缩进
        }
        for (const cpu of cpu_list) {
            const name = cpu.name;
            // 生成无注释的配置
            let yaml = `# CPU ${name} configuration\n\n` + cpu.areas.map(
                ([feature, area]) => `# feature: ${feature}\n${area.document.toString(options)}`
            ).join('\n\n');
            const filename = `${posix.join(context.work_path, cpu.output_dir, name)}.zyml`;
            await write_file(filename, yaml, { encoding: 'utf8', line_ending: 'LF' });
            console.log(`\t${filename}`);
        }
    }

    // 生成最终待转换数据
    return gen_list(cpu_list);
}

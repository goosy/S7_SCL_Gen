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
 * @property {string} value - symbolic expression
 * @property {string} desc - Error description
 */

class CPU {
    /** @type {string} */
    name;                             // CPU name
    /** @type {string} */
    platform;                         // Set by CPU documentation, default 'step7'
    /** @type {string} */
    device;                           // Set by CPU documentation

    #areas = {};                      // The CPU's Ribbon
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
    output_dir;                            // output folder

    /** @type {S7SymbolEmitter} */
    symbols = new S7SymbolEmitter();       // Symbol dispatch center
    /** @type {Promise.<S7Symbol>[]} */
    async_symbols = [];                    // List of asynchronous symbols for this CPU
    /** @type {NonSymbol[]} */
    non_symbols = [];                      // Non-symbol list for this CPU .push({ value, desc: s7_expr_desc });

    /** @type {IntHashList} */
    conn_ID_list = new IntHashList(16);    // List of used connection IDs
    /** @type {Object.<string, number>} */
    conn_host_list = {};                   // List of used connection addresses
    /**
     * @type { {
     *   tagname: string,
     *   location: string,
     *   event: string,
     *   PV1: string
     * } }
     */
    alarms_list = [];                     // Alarm list of this CPU

    constructor(name) {
        this.name = name;
        this.output_dir = name;
    }
}

/**
 * @constructor
 * @extends {Map<string, CPU>}
 */
class Cpu_Pool extends Map {
    /**
     * Returns a CPU by name. If the CPU with that name does not exist, generate a new CPU.
     * @param {string} name
     * @returns {CPU}
     */
    get(name) {
        if (super.has(name)) {
            return super.get(name);
        }
        this.set(name, new CPU(name));
        return super.get(name);
    }
}

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
    const line_ends = str.matchAll(/\r\n|\n|\r|$/g).map(match => match.index);
    const error = new SyntaxError('SCL文件出错: (** 或 **) 必须在一行的开头，行尾只能有空格，并且必须成对出现。');
    const error_result = { scl, error };

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
    if (typeof includes === 'string') return includes;
    const filenames = includes ? includes.toJSON() : [];
    if (!Array.isArray(filenames)) return '';
    const code = [];
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
 * Load specified document
 * The life cycle is the first scan, and the main function is to extract symbols
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
    }
    if (feature !== document.feature) {
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

    // Built-in symbol documentation
    const buildin_doc = BUILDIN_SYMBOLS.documents.find(doc => doc.feature === feature).clone();
    buildin_doc.CPU = cpu;
    buildin_doc.gcl = BUILDIN_SYMBOLS;
    add_symbols(
        buildin_doc,
        get_Seq(buildin_doc, 'symbols')
    );

    // Symbol references (not exported in symbol table)
    if (feature === 'CPU') {
        // built-in references
        const build_references = add_symbols(
            buildin_doc,
            get_Seq(buildin_doc, 'reference_symbols')
        );
        for (const symbol of build_references) symbol.exportable = false;
        // forward reference
        const references = add_symbols(
            document,
            get_Seq(document, 'reference_symbols')
        );
        for (const symbol of references) symbol.exportable = false;
    }

    // Document prefix
    add_symbols(
        document,
        get_Seq(document, 'symbols')
    );

    // Pass the node to locate the source code location
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
    // Push documents by type to CPU
    cpu.set_area(feature, area);
    // Convert each item of area.list from YAMLNode to a data object that can be used by the template
    _converter.initialize_list(area);
}

async function parse_conf() {
    const docs = [];
    const cpu_list = [];
    const cpu_pool = new Cpu_Pool();
    const work_path = context.work_path;
    const silent = context.silent;
    try {
        silent || console.log('\nreadding GCL files: 读取配置文件：');
        for (const file of await readdir(work_path)) {
            if (/^.*\.ya?ml$/i.test(file)) {
                const filename = posix.join(work_path, file);
                const gcl = await GCL.load(filename);
                for (const doc of gcl.documents) {
                    const cpu = cpu_pool.get(doc.cpu_name);
                    Object.defineProperty(doc, 'CPU', {
                        value: cpu,
                        writable: false,
                        enumerable: true,
                        configurable: false,
                    });
                    // Ensure CPU priority
                    if (doc.feature === 'CPU') docs.unshift(doc);
                    else docs.push(doc);
                }
                silent || console.log(`\t${filename}`);
            }
        }
        for (const doc of docs) {
            await parse_doc(doc);
        }

        cpu_list.push(...cpu_pool.values());
        // wait for all symbols to complete
        for (const cpu of cpu_list) cpu.symbols.emit('finished');
        await Promise.all(cpu_list.flatMap(cpu => cpu.async_symbols));
    } catch (e) {
        console.log(e);
    }
    return cpu_list;
}

/**
 * @typedef {Object} CopyItem
 * @property {string} source the source file
 * @property {string} input_dir base directory for source file
 * @property {string} distance the distance file
 * @property {string} output_dir base directory for distance file
 * @property {string} type 'copy'
 * @property {string|null} IE the encoding of the source file
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
 * @property {string} distance the distance file
 * @property {string} output_dir base directory for distance file
 * @property {string} type 'convert'
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
            }

            for (const file of area.files) {
                /** @type string | undinfied */
                const IE = file.IE;
                const line_ending = file.line_ending ?? context.line_ending;
                const OE = file.OE ?? context.OE;
                const is_filename = typeof file === 'string';
                const source = is_filename ? file : file.filename;
                const type = 'copy';
                if (/\\/.test(source)) elog(new SyntaxError('Use "/" as the path separator!'));
                let [dir, base] = source.split('//');
                if (base === undefined) {
                    base = posix.basename(source);
                    dir = posix.dirname(source);
                }
                const input_dir = posix.join(work_path, dir);
                for (const path of await globby(posix.join(input_dir, base))) {
                    const source = posix.relative(input_dir, path);
                    const distance = source;
                    copy_list.push({
                        ...common_options, type,
                        IE, input_dir, source,
                        OE, output_dir, distance,
                        line_ending,
                    });
                }
            };

            const gcl = area.document.gcl;
            const gen_copy_list = converter[feature].gen_copy_list;
            assert.equal(typeof gen_copy_list, 'function', `innal error: gen_copy_list of ${feature} is not a function`);
            const f_copy_list = gen_copy_list(area).map(
                item => ({ ...common_options, ...item, type: 'copy' })
            );
            copy_list.push(...f_copy_list);

            // push each gen(area) to convert_list
            const gen = converter[feature].gen;
            assert.equal(typeof gen, 'function', `innal error: gen of ${feature} is not a function`);
            for (const item of gen(area)) {
                const distance = item.distance;
                const output_dir = item.output_dir;
                const tags = { // Provide some default variables
                    context, gcl,
                    pad_left, pad_right, fixed_hex,
                    cpu_name, feature, platform,
                    ...area,
                    ...item.tags,
                }
                const type = 'convert';
                const template = await get_template(item.template, feature);
                convert_list.push({ ...common_options, type, tags, template, distance, output_dir });
            };
        }
    };
    const extra_gen_list = [...gen_symbols(cpu_list), ...gen_alarms(cpu_list)];
    for (const item of extra_gen_list) {
        item.type = 'convert';
    }
    convert_list.push(...extra_gen_list);
    return { copy_list, convert_list };
}

export async function gen_data() {
    WRONGTYPESYMBOLS.clear();
    // The first scan loads configuration\extracts symbols\creates CPU and diagnostic information
    const cpu_list = await parse_conf();

    // The second scan completes the data
    for (const cpu of cpu_list) {
        for (const [feature, area] of cpu.areas) {
            const build_list = converter[feature].build_list;
            if (typeof build_list === 'function') build_list(area);
        };
    }
    // non-symbolic prompt
    const non_symbols_info_list = cpu_list.flatMap(cpu => cpu.non_symbols.map(
        ({ expression, desc }) => `\t${pad_right(expression, 24)}: ${desc}`
    ));
    if (!context.silent && non_symbols_info_list.length) {
        console.log(`
warning: 警告：
The following values isn't a symbol in GCL file. 配置文件中以下符号值无法解析成S7符号
The converter treats them as S7 expressions without checking validity. 转换器将它们视为S7表达式不检验有效性
Please make sure they are legal and valid S7 expressions. 请确保它们是合法有效的S7表达式
${non_symbols_info_list.join('\n')}`
        );
    }

    // User symbol type definition error message, the wrong type of symbol does not belong to the CPU
    if (!context.silent && WRONGTYPESYMBOLS.size) {
        console.log(`
warning: 警告：
The user defined type of following symbols is wrong. 配置文件中以下符号用户定义的类型有误
The converter convert them to the correct type . 转换器将它们转换为合法有效的类型`
        );
        for (const symbol of WRONGTYPESYMBOLS) {
            console.log(`\t${symbol.name}:  'user defined type: ${symbol.userDefinedType}'  'actual type: ${symbol.type}'`);
        }
    }

    // Output uncommented configuration
    if (context.output_zyml) {
        console.log('output the uncommented configuration file:');
        const options = {
            commentString() { return ''; }, // Comments options
            indentSeq: false                // Whether the list is indented
        }
        for (const cpu of cpu_list) {
            const area_str_list = cpu.areas.map(
                ([feature, area]) => `# feature: ${feature}\n${area.document.toString(options)}`
            );
            const cpu_name = cpu.name;
            // Generate configuration without annotations
            const yaml = `# CPU ${cpu_name} configuration\n\n${area_str_list.join('\n\n')}`;
            const filename = `${posix.join(context.work_path, cpu.output_dir, cpu_name)}.zyml`;
            await write_file(filename, yaml, { encoding: 'utf8', line_ending: 'LF' });
            console.log(`\t${filename}`);
        }
    }

    // Generate final data to be converted
    return gen_list(cpu_list);
}

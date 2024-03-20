import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    Document, parseAllDocuments,
    isMap, isSeq, isAlias, isScalar,
    LineCounter,
    visit,
} from 'yaml';
import { read_file } from './util.js';
import { STRING, ensure_value, nullable_value } from './s7data.js';

function merge(document) {
    visit(document, {
        Pair(key, pair, path) {
            if (pair.key && pair.key.value === '<<') {
                const parent = path[path.length - 1];
                const range = [pair.key.range[0], pair.value.range[2]];
                const not_a_alias = new SyntaxError(`merge value must be a alias 合并值必须是别名`);
                not_a_alias.range = range;
                assert(isAlias(pair.value), not_a_alias);
                parent.items.splice(key, 1);
                const source = pair.value.resolve(document);
                const not_a_map = new SyntaxError(`merge value must be a Map 合并引用值必须是对象`);
                not_a_map.range = range;
                assert(isMap(source), not_a_map);
                let len = 0;
                source.items.forEach(node => {
                    if (parent.has(node.key.value)) return;
                    len++;
                    parent.items.unshift(node);
                });
                return key + len;
            }
        },
    })
    visit(document, {
        Alias(_, node) {
            return node.resolve(document);
        }
    })
}

export function isString(node) {
    return isScalar(node) &&
        ['PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE'].includes(node.type);
}

/**
 * 取得指定节点下的列表，如果没有列表，返回空值
 * @param {Document} doc
 * @param {string} nodename
 * @returns {array}
 */
export function get_Seq(doc, nodename) {
    const symbols_node = doc.get(nodename);
    return symbols_node?.items ?? [];
}

/**
 * Parses YAML commented SCL strings and converts them into separate suitable forms
 *
 * @param {string} str - the SCL string with YAML comment
 * @return {{scl: string, yaml: string, error: SyntaxError | null}} an object containing the parsed SCL and YAML
 */
function parse_YAML_commented_SCL(str) {
    let scl = '';
    let yaml = '';
    let inYAML = false;
    let start = 0;
    const line_ends = [
        ...str.matchAll(/\r\n|\n|\r/g),
        { index: str.length },
    ].map(match => match.index);
    const error = new SyntaxError(`SCL文件出错: (** 或 **) 必须在一行的开头，行尾只能有空格，并且必须成对出现。`);
    const error_result = { scl, yaml, error };

    // SCL中只能用注释进行符号定义
    for (const end of line_ends) {
        const line = str.substring(start, end);
        const head = line.replace(/\n|\r/g, '').substring(0, 3);
        const on_start = head === '(**';
        const on_end = head === '**)';

        if (on_start) {
            if (inYAML || line.trim() !== '(**') return error_result;
            inYAML = true;
            yaml += line.replace('(**', '---');
        } else if (on_end) {
            if (!inYAML || line.trim() !== '**)') return error_result;
            inYAML = false;
            yaml += line.replace('**)', '...');
        } else if (inYAML) {
            yaml += line;
        } else {
            scl += line;
            yaml += line.trim() === '' ? line : '#' + line.substring(1);
        }
        start = end;
    }
    scl = scl.trim();

    return { scl, yaml, error: null };
}

/**
 * Retrieves the CPU and feature from the given document.
 *
 * @param {Document} document - the document to extract CPU and feature information from
 * @return {{CPU: string, feature: string, error: string | null}} an object containing the CPU, feature, and error information
 */
function get_cpu_and_feature(document) {
    const name = nullable_value(STRING, document.get('name'))?.value;
    if (name) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]*-[a-zA-Z]+$/.test(name)) return {
            cpu: '',
            feature: '',
            error: name,
        };
        const [cpu, feature] = name.split('-');
        return { cpu, feature, error: null };
    }
    const cpu = document.get('CPU');
    const feature = document.get('feature');
    return { cpu, feature, error: null };
}

export class GCL {
    #file;
    get file() {
        return this.#file;
    }
    /** @type {Document[]} */
    #documents;
    get documents() {
        return this.#documents;
    }
    #source;
    get source() {
        return this.#source;
    }
    #scl = '';
    get scl() {
        return this.#scl;
    }
    #yaml;
    #line_counter;
    get_pos_data(start, end) {
        const pos = this.#line_counter.linePos(start);
        const code = this.#source.substring(start, end).trim();
        return { ...pos, code };
    }
    get_pos_info(start, end) {
        const document = this.#documents.find(doc => {
            const range = doc.contents.range;
            return range[0] < start && end < range[2];
        })
        const pos_data = this.get_pos_data(start, end);
        return `
        位置: file:///${this.#file}:${pos_data.line}:${pos_data.col}` + (document ? `
        文档: ${document.CPU.name}-${document.feature}` : '') + `
        代码: \`${pos_data.code}\``;
    }
    #MD5;
    get MD5() {
        return this.#MD5;
    }

    constructor() {
        this.#line_counter = new LineCounter();
    }

    parse_documents(options) {
        this.#documents = parseAllDocuments(this.#yaml, { version: '1.2', lineCounter: this.#line_counter });
        for (const document of this.#documents) {
            try {
                // yaml library only support merge key in YAML 1.1
                // so use our own merge function
                merge(document);
            } catch (error) {
                console.error(`${error.message}:${this.get_pos_info(...error.range)}`);
                process.exit(1);
            }

            const {
                cpu = options.CPU,
                feature = options.feature,
                error: error
            } = get_cpu_and_feature(document);
            if (error) {
                throw new Error(`"${this.file}"文件中某文档的 name:${error} 不正确！`);
            }
            if (typeof cpu !== 'string') {
                throw new SyntaxError(`"${this.file}"文件中某文档的 CPU 没有正确提供!`);
            }
            if (typeof feature !== 'string') {
                throw new SyntaxError(`"${this.file}"文件中某文档的 feature 没有正确提供!`);
            }

            document.gcl = this;
            document.offset ??= 0;
            document.CPU = cpu;
            Object.defineProperty(document, 'feature', {
                get() {
                    return feature;
                },
                enumerable: true,
                configurable: false,
            });
        }
    }

    async load(yaml_or_filename, options = {}) {
        const {
            encoding = 'utf8',
            isFile = true,
            inSCL = false,
        } = options;
        this.#file = isFile ? yaml_or_filename : '';
        this.#source = isFile ? await read_file(this.#file, { encoding }) : yaml_or_filename;
        this.#MD5 = createHash('md5').update(this.#source).digest('hex');

        if (isFile ? inSCL : false) {  //只有在文件中才能是SCL
            const { scl, yaml, error } = parse_YAML_commented_SCL(this.#source);
            if (error) elog(error);
            this.#yaml = yaml;
            this.#scl = scl;
        } else {
            this.#yaml = this.#source;
            this.#scl = '';
        }
        this.parse_documents(options);
    }
}

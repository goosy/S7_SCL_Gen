import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    Document, parseAllDocuments,
    isMap, isSeq, isAlias, isScalar,
    LineCounter,
    visit,
} from 'yaml';
import { read_file } from './util.js';
import { STRING, nullable_value } from './s7data.js';

function merge(document) {
    visit(document, {
        Pair(key, pair, path) {
            if (pair.key && pair.key.value === '<<') {
                const parent = path[path.length - 1];
                const range = [pair.key.range[0], pair.value.range[2]];
                const not_a_alias = new SyntaxError('merge value must be a alias 合并值必须是别名');
                not_a_alias.range = range;
                assert(isAlias(pair.value), not_a_alias);
                parent.items.splice(key, 1);
                const source = pair.value.resolve(document);
                const not_a_map = new SyntaxError('merge value must be a Map 合并引用值必须是对象');
                not_a_map.range = range;
                assert(isMap(source), not_a_map);
                let len = 0;
                for (const node of source.items) {
                    if (parent.has(node.key.value)) continue;
                    len++;
                    parent.items.unshift(node);
                };
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
 * Get the list under the specified node, if there is no list, return a null value
 * 
 * @param {Document} doc
 * @param {string} nodename
 * @returns {array}
 */
export function get_Seq(doc, nodename) {
    const symbols_node = doc.get(nodename);
    return symbols_node?.items ?? [];
}

/**
 * Retrieves the CPU and feature from the given document.
 *
 * @param {Document} document - the document to extract CPU and feature information from
 * @return {{CPU: string, feature: string, error: string | null}} an object containing the CPU, feature, and error information
 */
function get_cpu_and_feature(document) {
    let error = null;
    const name = nullable_value(STRING, document.get('name'))?.value;
    if (name) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]*-[a-zA-Z]+$/.test(name)) return {
            cpu_name: '',
            feature: '',
            error: `name:${name} 不正确！`,
        };
        const [cpu_name, feature] = name.split('-');
        return { cpu_name, feature, error: null };
    }
    let cpu_name = document.get('CPU');
    if (typeof cpu_name !== 'string') {
        cpu_name = '';
        error = 'CPU 没有正确提供!';
    }
    let feature = document.get('feature');
    if (typeof feature !== 'string') {
        feature = '';
        error = 'feature 没有正确提供!';
    }
    return { cpu_name, feature, error };
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
        位置: file:///${this.#file}:${pos_data.line}:${pos_data.col}${document ? `
        文档: ${document.CPU.name}-${document.feature}` : ''}
        代码: \`${pos_data.code}\``;
    }
    #MD5;
    get MD5() {
        return this.#MD5;
    }

    parse_documents() {
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

            const { cpu_name, feature, error } = get_cpu_and_feature(document);
            if (error) {
                throw new Error(`"${this.file}"文件中某文档 ${error}`);
            }

            document.gcl = this;
            document.offset ??= 0;
            Object.defineProperty(document, 'cpu_name', {
                get() {
                    return cpu_name;
                },
                enumerable: true,
                configurable: false,
            });
            Object.defineProperty(document, 'feature', {
                get() {
                    return feature;
                },
                enumerable: true,
                configurable: true,
            });
        }
    }

    constructor(yaml, options = {}) {
        this.#line_counter = new LineCounter();
        this.#yaml = yaml;
        const {
            CPU,
            feature,
            filename = '',
            source = yaml,
            scl = '',
        } = options;
        this.#file = filename;
        this.#source = source;
        this.#scl = scl;
        this.#MD5 = createHash('md5').update(this.#source).digest('hex');
        this.parse_documents();
    }

    static async load(filename, options = {}) {
        const encoding = options.encoding ?? 'utf8';
        const yaml = await read_file(filename, { encoding });
        const gcl = new GCL(yaml, {
            ...options,
            filename,
            source: yaml,
        });
        return gcl;
    }
}

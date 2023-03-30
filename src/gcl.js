import assert from 'assert/strict';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import {
    Document, parseAllDocuments,
    isMap, isSeq, isAlias,
    LineCounter,
    visit,
} from 'yaml';

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
    #SCL = '';
    get SCL() {
        return this.#SCL;
    }
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
        const docinfo = document
            ? `
        文档:${document.get('CPU')}-${document.get('feature')}`
            : '';
        const pos_data = this.get_pos_data(start, end);
        return `
        文件:${this.#file}${docinfo}
        代码:L${pos_data.line} C${pos_data.col}: ${pos_data.code}`;
    }
    #MD5;
    get MD5() {
        return this.#MD5;
    }

    constructor() {
        this.#line_counter = new LineCounter();
    }

    async load(yaml, options = {}) {
        const {
            encoding = 'utf8',
            isFile = true,
            filename = '',
        } = options;
        let inSCL = options.inSCL ?? false;
        if (isFile) {
            this.#file = yaml;
            this.#source = (await readFile(this.#file, { encoding }));
            yaml = inSCL ? '' : this.#source;
        } else {
            inSCL = false; //只有在文件中才能是SCL
            this.#file = filename;
            this.#source = yaml;
        }
        this.#MD5 = createHash('md5').update(this.#source).digest('hex');

        const line_ends = [...this.#source.matchAll(/\r\n|\n|\r/g)].map(match => match.index);
        line_ends.push(this.#source.length);

        if (inSCL) { // SCL中只能用注释进行符号定义
            let SCL = '';
            let inYAML = false;
            let start = 0;
            for (const end of line_ends) {
                const line = this.#source.substring(start, end);
                const head = line.replace(/\n|\r/g, '').substring(0, 3);
                const isStart = head === '(**';
                const isEnd = head === '**)';
                const flag_error = new SyntaxError(`SCL文件${this.#file}文件出错: (** 或 **) 必须在一行的开头，行尾只能有空格，并且必须成对出现。`);

                if (isStart && inYAML) throw flag_error;
                if (isEnd && !inYAML) throw flag_error;
                if (isStart) {
                    inYAML = true;
                    assert.equal(line.trim(), '(**', flag_error);
                    yaml += line.replace('(**', '---');
                } else if (isEnd) {
                    inYAML = false;
                    assert.equal(line.trim(), '**)', flag_error);
                    yaml += line.replace('**)', '...');
                } else if (inYAML) {
                    yaml += line;
                } else {
                    SCL += line;
                    yaml += line.trim() === '' ? line : '#' + line.substr(1);
                }
                start = end;
            }
            this.#SCL = SCL.trim();
        }
        const documents = this.#documents = [];
        for (const document of parseAllDocuments(yaml, { version: '1.2', lineCounter: this.#line_counter })) {
            documents.push(document);
            try {
                // yaml library only support merge key in YAML 1.1
                merge(document);
            } catch (error) {
                console.error(`${error.message}:${this.get_pos_info(...error.range)}`);
                process.exit(1);
            }
            const CPU = document.get('CPU') ?? document.get('name') ?? options.CPU;
            const CPU_error = new SyntaxError(`"${this.file}"文件中有一文档的 name 或者 CPU 没有提供，必须提供一个字符串或字符串数组!`);
            const CPUs = isSeq(CPU) ? CPU.items.map(item => String(item)) : [CPU];
            const feature = document.get('feature') ?? document.get('type') ?? options.feature;
            if (options.filename !== 'buildin') {
                assert(typeof feature === 'string', new SyntaxError(`${this.file} 文件的 feature 必须提供，并且必须是字符串!`));
                if (CPUs.length === 0) throw CPU_error;
            }
            CPUs.forEach((CPU, index) => {
                assert(typeof CPU === 'string' && CPU !== '', CPU_error);
                // if multi CPU then clone document
                const doc = index === 0 ? document : document.clone();
                if (index > 0) documents.push(doc);
                doc.gcl = this;
                doc.offset ??= 0;
                doc.CPU = CPU;
                Object.defineProperty(doc, 'feature', {
                    get() {
                        return feature;
                    },
                    enumerable: true,
                    configurable: false,
                });
            });
        }
    }
}

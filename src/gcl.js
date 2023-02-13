import assert from 'assert/strict';
import { readFile } from 'fs/promises';
import {
    Document,
    isDocument, isAlias, isNode,
    isCollection, isMap, isSeq,
    isPair, isScalar,
    parseAllDocuments, parseDocument,
} from 'yaml';
import { createHash } from 'crypto';

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
    #lines;
    get lines() {
        return this.#lines;
    }
    get_lines() {
        this.#lines = [];
        let index, position = 0;
        do {
            index = this.#source.indexOf('\n', position);
            if (index > -1) {
                this.#lines.push([position, index]);
                position = index + 1;
            }
        } while (index > -1);
        if (position < this.#source.length) this.#lines.push([position, this.#source.length]);
    }
    #MD5;
    get MD5() {
        return this.#MD5;
    }

    constructor() { }

    get_coorinfo(start, end) {
        const ln = 1 + this.#lines.findIndex(([s, e]) => s <= start && start < e);
        const col = start - this.#lines[ln - 1][0];
        const code = this.#source.substring(start, end + 1);
        return { ln, col, code };
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
            yaml = this.#source = (await readFile(this.#file, { encoding }));
        } else {
            inSCL = false; //只有在文件中才能是SCL
            this.#file = filename;
            yaml = this.#source = yaml;
        }
        this.get_lines();
        this.#documents = [];
        this.#MD5 = createHash('md5').update(this.#source).digest('hex');

        if (inSCL) { // SCL中只能用注释进行符号定义
            this.#SCL = '';
            let inYAML = false;
            yaml = '';
            for (const [start, end] of this.#lines) {
                const line = this.#source.substring(start, end + 1);
                const isStart = line.startsWith('(**');
                const isEnd = line.startsWith('**)');
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
                    this.#SCL += line;
                    yaml += '#' + line.substr(1);
                }
            }
        }
        this.#documents = parseAllDocuments(yaml, { version: '1.1' }); // only YAML 1.1 support merge key
        const enumerable = true;
        const configurable = false;
        for (const doc of this.#documents) {
            doc.gcl = this;
            doc.offset ??= 0;
            const is_buildin = options.filename === 'buildin';
            const CPU = doc.get('CPU') ?? doc.get('name') ?? options.CPU;
            const CPUs = isSeq(CPU)
                ? CPU.items.map(item => String(item))
                : is_buildin ? [] : [CPU];
            Object.defineProperty(doc, 'CPUs', {
                get() {
                    return CPUs;
                },
                enumerable,
                configurable
            });
            const feature = doc.get('feature') ?? doc.get('type') ?? options.feature;
            Object.defineProperty(doc, 'feature', {
                get() {
                    return feature;
                },
                enumerable,
                configurable
            });
            this[feature] = doc;
        }
    }
}

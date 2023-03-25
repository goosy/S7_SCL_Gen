import assert from 'assert/strict';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { Document, parseAllDocuments, isSeq, } from 'yaml';
export {
    isDocument, isAlias, isNode,
    isCollection, isMap, isSeq,
    isPair, isScalar,
} from 'yaml';

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
        const documents = [];
        for (const document of parseAllDocuments(yaml, { version: '1.1' })) { // only YAML 1.1 support merge key
            const CPU_error = new SyntaxError(`"${this.file}"文件的 name 或者 CPU 必须提供，并且必须是字符串或字符串数组!`);
            const feature = document.get('feature') ?? document.get('type') ?? options.feature;
            const CPU = document.get('CPU') ?? document.get('name') ?? options.CPU;
            const CPUs = isSeq(CPU) ? CPU.items.map(item => String(item)) : [CPU];
            if (options.filename !== 'buildin') {
                assert(typeof feature === 'string', new SyntaxError(`${this.file} 文件的 feature 必须提供，并且必须是字符串!`));
                if (CPUs.length === 0) throw CPU_error;
            }
            CPUs.forEach((CPU, index) => {
                assert(typeof CPU === 'string' && CPU !== '', CPU_error);
                // if multi CPU then clone document
                const doc = index === 0 ? document : document.clone();
                doc.gcl = this;
                doc.offset ??= 0;
                doc.CPU = CPU;
                documents.push(doc);
                Object.defineProperty(doc, 'feature', {
                    get() {
                        return feature;
                    },
                    enumerable: true,
                    configurable: false,
                });
            });
        }
        this.#documents = documents;
    }
}

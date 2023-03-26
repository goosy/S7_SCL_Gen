import assert from 'assert/strict';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { Document, parseAllDocuments, isSeq, LineCounter } from 'yaml';
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
    #line_counter;
    get_pos_info(start, end) {
        const pos = this.#line_counter.linePos(start);
        const code = this.#source.substring(start, end).trim();
        return { ...pos, code };
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
            yaml = this.#source = (await readFile(this.#file, { encoding }));
        } else {
            inSCL = false; //只有在文件中才能是SCL
            this.#file = filename;
            this.#source = yaml;
        }
        this.#MD5 = createHash('md5').update(this.#source).digest('hex');

        const line_starts = [...this.#source.matchAll(/^/gm)].map(match => {
            const index = match.index;
            this.#line_counter.addNewLine(index);
            return index;
        });
        if (inSCL) { // SCL中只能用注释进行符号定义
            this.#SCL = '';
            let inYAML = false;
            yaml = '';
            let start = 0;
            for (const end of line_starts.slice(1)) {
                const line = this.#source.substring(start, end);
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
                    yaml += line.trim() === '' ? line : '#' + line.substr(1);
                }
                start = end;
            }
        }
        const documents = this.#documents = [];
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
    }
}

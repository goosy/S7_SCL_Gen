import { readFile } from 'fs/promises';
import {
    Document,
    parseAllDocuments,
    parseDocument,
} from 'yaml';

// export {
//     isDocument, isAlias, isNode,
//     isCollection, isMap, isSeq, isPair, isScalar
// } from 'yaml';
export class GCL {
    #file;
    get file() {
        return this.#file;
    }
    #encoding;
    get encoding() {
        return this.#encoding;
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
    constructor() {
    }
    async load(file, options = { encoding: 'utf8' }) {
        const {
            encoding = 'utf8',
            inSCL = false,
        } = options;
        this.#file = file;
        this.#source = await readFile(this.#file, { encoding });
        if (inSCL) {
            this.#documents = [];
            // SCL注释中只能进行GCL符号定义
            this.#SCL = this.#source.replace(/(?<=^|\n)\(\*(symbols:\s+[\s\S]*?)\*\)/g, (_, sym_yaml, offset) => {
                const doc = parseDocument(sym_yaml);
                this.#documents.push(doc);
                doc.offset = offset + 2;
                return '';
            })
        } else {
            this.#documents = parseAllDocuments(this.#source, { version: '1.1' }); // only YAML 1.1 support merge key
        }
        const enumerable = true;
        const configurable = false;
        for (const doc of this.#documents) {
            doc.gcl = this;
            doc.offset ??= 0;
            const CPU = doc.get('CPU') ?? doc.get('name')?? options.CPU;
            Object.defineProperty(doc, 'CPU', {
                get() {
                    return CPU;
                },
                enumerable,
                configurable
            });
            const type = doc.get('type') ?? options.type;
            Object.defineProperty(doc, 'type', {
                get() {
                    return type;
                },
                enumerable,
                configurable
            });
            // console.log(doc);
        }
    }
}
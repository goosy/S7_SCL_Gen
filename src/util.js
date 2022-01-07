import { access, mkdir, copyFile, readFile, writeFile } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import iconv from 'iconv-lite';
const module_path = join(fileURLToPath(import.meta.url), "../../");

export class IncHLError extends Error {
    num;
    size;
    constructor(message, options) {
        super(message, options);
        this.num = options?.num;
        this.size = options?.size;
    }
}

class IncreaseHL { // abstract class
    curr_item;
    #curr_size = 1;
    #curr_index;
    constructor(next = 0, size = 1) {
        this.#curr_index = next;
        this.#curr_size = size;
    }
    next() {
        this.#curr_index += this.#curr_size;
    }
    check(num) {
        if (num == null) {
            num = this.get_new();
        } else {
            // 不能非正数字
            if (typeof num !== 'number' || isNaN(num) || num < 0) throw new TypeError(`${num} 不是正整数!`);
        }
        return num;
    }
    get_new() {
        const num = this.#curr_index;
        this.next();
        return num;
    }
    push(num, size = 1) {
        this.#curr_index = parseInt(num) + size;
        this.#curr_size = size;
    }
}
export class IntIncHL extends IncreaseHL {
    #list = [];
    check(num) {
        if (num == null || num === 0) {
            do {
                num = super.check(null);
            } while (this.#list.includes(num));
        } else {
            num = super.check(num);
            // 不能重复
            if (this.#list.includes(num)) throw new IncHLError(`存在重复的地址 ${num}!`);
        }
        return num;
    }
    push(num) {
        try {
            num = this.check(num);
            super.push(num, 1);
            this.#list.push(num);
        } catch (e) {
            if (e instanceof TypeError) {
                throw new TypeError(e.message, { cause: num });
            } else if (e instanceof IncHLError) {
                throw new IncHLError(e.message, { num });
            }
        }
        return num;
    }
}

function dec2foct(num) {
    const bit = num % 8;
    const byte = (num - bit) / 8
    return [byte, bit]
}

function foct2dec(byte, bit) {
    if (typeof byte !== 'number' || isNaN(byte) || byte < 0) throw new TypeError(`${byte} 不是正整数!`);
    return (byte == null || bit == null) ? null : byte * 8 + bit;
}

export class S7IncHL extends IncreaseHL {
    #list = {};
    constructor(next = [0, 0]) {
        super(foct2dec(...next));
    }

    convert_size(size) {
        const byte = Math.floor(size);
        const bit = (size - byte) * 10;
        if (byte > 0 && bit > 0) throw new IncHLError(`size ${size} is wrong!`);
        return foct2dec(byte, bit);
    }

    check(num, size) {
        if (num == null) {
            do {
                num = super.check(null);
            } while (this.#list[num + ':' + size]);
        } else {
            num = super.check(num);
            // 不能重复
            if (this.#list[num + ':' + size]) throw new IncHLError(`存在重复的 ${dec2foct(num).join('.')} (size:${size})!`);
        }
        return num;
    }

    push(item, size = 1.0) {
        let num;
        try {
            if(item[0] != null) num = foct2dec(...(item ?? []));
            num = this.check(num, size);
            this.#list[num + ':' + size] = true;
            let remainder = num % 8;
            if (size == 1.0 && remainder > 0) num += 8 - remainder;
            remainder = num % 16;
            if (size >= 2.0 && remainder > 0) num += 16 - remainder;
            super.push(num, this.convert_size(size));
        } catch (e) {
            if (e instanceof IncHLError) {
                throw new IncHLError(e.message, { num, size });
            }
            throw new TypeError(e.message, { cause: num });
        }
        return dec2foct(num);
    }
}

/**
 * 将item左侧用占位符填充至指定长度
 * @date 2021-11-17
 * @param {number|string} item
 * @param {number} length
 * @param {string} placeholder=''
 * @returns {string}
 */
export function str_padding_left(item, length, placeholder = ' ') {
    const str = Array(length).join(placeholder) + placeholder + item;
    return str.slice(-length);
}
/**
 * 将item右侧用占位符填充至指定长度
 * @date 2021-11-17
 * @param {number|string} item
 * @param {number} length
 * @param {string} placeholder=''
 * @returns {string}
 */
export function str_padding_right(item, length, placeholder = ' ') {
    const str = item + placeholder + Array(length).join(placeholder);
    return str.slice(0, length);
}

export function fixed_hex(num, length) {
    return str_padding_left(num.toString(16), length, '0').toUpperCase();
}


export function lazyassign(obj, prop, lazyvalue, options) {
    // must enumerable default
    const { writable = false, enumerable = true, configurable = false } = options ?? {};
    if (typeof lazyvalue === 'function') {
        Object.defineProperty(obj, prop, {
            get() {
                const value = lazyvalue();
                if (value == null) throw new Error(`lazyvalue not ready`);
                lazyassign(obj, prop, value, options);
                return value;
            },
            enumerable,
            configurable: true
        });
    } else {
        Object.defineProperty(obj, prop, {
            value: lazyvalue,
            writable,
            enumerable,
            configurable,
        });
    }
}

export async function prepare_dir(dir) {
    let parents = dirname(dir);
    await access(parents).catch(async () => {
        await prepare_dir(parents);
    });
    await access(dir).catch(async () => {
        await mkdir(dir).catch(
            err => {
                if (err.code !== 'EEXIST') console.log(err);
            }
        );
    });
}

/**
 * 复制文件
 * 目标为文件夹时，以'/'结尾
 * @date 2021-09-28
 * @param {string} file
 * @param {string|string[]} dstList
 */
export async function copy_file(file, dstList) {
    async function _copy(src, dst) {
        if (typeof src != 'string') return;
        if (typeof dst != 'string') return;
        if (dst.endsWith('/')) {
            dst += basename(file);
        }
        let srcPath = join(module_path, src);
        let dstPath = join(work_path, dst);
        await prepare_dir(dirname(dstPath));
        await copyFile(srcPath, dstPath);
    }
    if (!Array.isArray(dstList)) dstList = [dstList];
    const work_path = process.cwd();
    for (const dst of dstList) { // for-of 实现异步顺序执行
        await _copy(file, dst);
    }
}

export async function read_file(filename, options={}) {
    options.encoding ??= "utf8";
    let exist = true;
    await access(filename).catch(() => {
        exist = false;
    });
    if (exist) {
        return await readFile(filename, options);
    }
    console.log(`warnning: ${filename} file not found`);
    return '';
}

function unix2dos(str) {
    return str.replaceAll('\r', '').replaceAll('\n', '\r\n');
}

function dos2unix(str) {
    return str.split('\r\n').join('\n');
}

export async function write_file(filename, content, { encoding = "utf8", lineEndings = "linux"}) {
    await prepare_dir(dirname(filename));
    let buff = iconv.encode(lineEndings == "windows" ? unix2dos(content) : dos2unix(str), encoding);
    await writeFile(filename, buff);
}

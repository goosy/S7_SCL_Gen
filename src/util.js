import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { Integer } from './s7data.js';
import pkg from '../package.json' assert { type: 'json' };

const module_path = posix.join(fileURLToPath(import.meta.url).replace(/\\/g, '/'), "../../");
const work_path = process.cwd().replace(/\\/g, '/');
export const context = {
    module_path,
    work_path,
    version: pkg.version,
    output_zyml: false,
    noconvert: false,
    silent: false,
    encoding: 'gbk',
    lineEndings: 'windows',
};

export function compare_str(a, b) {
    if (a > b) return 1;
    if (a < b) return -1;
    return 0;
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
 * @param {string} src
 * @param {string|string[]} dst
 */
export async function copy_file(src, dst) {
    async function _copy(src, dst) {
        if (typeof src != 'string') return;
        if (typeof dst != 'string') return;
        if (dst.endsWith('/')) dst += basename(src);
        await prepare_dir(dirname(dst));
        await cp(src, dst, { recursive: true });
    }
    if (Array.isArray(dst)) {
        // Asynchronous sequential execution 异步顺序执行
        for (const item of dst) {
            await _copy(src, item);
        }
    } else {
        await _copy(src, dst);
    }
}

export async function read_file(filename, options = {}) {
    options.encoding ??= "utf8";
    let exist = true;
    await access(filename).catch(() => {
        exist = false;
    });
    if (exist) {
        return await readFile(filename, options);
    }
    if (!options.silent) console.log(`warnning: ${filename} file not found`);
    return '';
}

function unix2dos(str) {
    return str.replaceAll('\r', '').replaceAll('\n', '\r\n');
}

function dos2unix(str) {
    return str.split('\r\n').join('\n');
}

export async function write_file(filename, content, { encoding, lineEndings } = {}) {
    encoding ??= context.encoding;
    lineEndings ??= context.lineEndings;
    await prepare_dir(dirname(filename));
    let buff = iconv.encode(lineEndings == "windows" ? unix2dos(content) : dos2unix(content), encoding);
    await writeFile(filename, buff);
}

export function getClassName(obj) {
    return obj.constructor.name;
}

/**
 * 将item左侧用占位符填充至指定长度
 * 如果item本身超过该长度，则截取item右侧该长度子串
 * @date 2021-11-17
 * @param {number|string} item
 * @param {number} length
 * @param {string} placeholder=''
 * @returns {string}
 */
export function pad_left(item, length, placeholder = ' ') {
    return String(item).padStart(length, placeholder).slice(-length);
}

/**
 * 将item右侧用占位符填充至指定长度
 * 如果item本身超过该长度，则截取item左侧该长度子串
 * @date 2021-11-17
 * @param {number|string} item
 * @param {number} length
 * @param {string} placeholder=''
 * @returns {string}
 */
export function pad_right(item, length, placeholder = ' ') {
    return String(item).padEnd(length, placeholder).slice(0, length);
}

export function fixed_hex(num, length) {
    const HEX = num instanceof Integer ? num.HEX : num?.toString(16);
    return pad_left(HEX, length, '0').toUpperCase();
}

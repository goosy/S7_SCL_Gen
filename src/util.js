import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, posix, isAbsolute } from 'node:path';
import iconv from 'iconv-lite';
import { Integer } from './s7data.js';
import pkg from '../package.json' with { type: 'json' };

export {
    context, CURRENT_DOC, CURRENT_NODE,
    get_template,
    prepare_dir, copy_file, read_file, write_file,
    compare_str, pad_left, pad_right, fixed_hex,
    elog, lazyassign,
};

const module_path = posix.join(import.meta.dirname.replace(/\\/g, '/').replace(/\\/g, '/'), "..");
const work_path = process.cwd().replace(/\\/g, '/');
const context = {
    module_path,
    work_path,
    version: pkg.version,
    output_zyml: false,
    noconvert: false,
    silent: false,
    IE: 'utf8',
    OE: 'gbk',
    line_ending: 'CRLF',
};

const templates_cache = new Map();
/**
 * Retrieves a template for a given feature.
 *
 * @param {string} feature - the feature for which the template is needed
 * @param {string} template_file - the file containing the template
 * @return {Promise<string>} the template content as a string
 */
async function get_template(template_file, feature) {
    template_file ??= posix.join(module_path, 'src', 'converters', `${feature}.template`);
    const filename = isAbsolute(template_file)
        ? template_file
        : posix.resolve(template_file);
    if (templates_cache.has(filename)) return templates_cache.get(filename);
    let template = await read_file(filename);
    templates_cache.set(filename, template);
    return template;
}

let CURRENT_DOC;
let CURRENT_NODE;

function elog(msg) {
    if (msg instanceof Error) throw msg;
    throw new Error(msg);
}

async function prepare_dir(dir) {
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
async function copy_file(src, dst) {
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

async function read_file(filename, options = {}) {
    const encoding = options.encoding ?? context.IE;
    let exist = true;
    await access(filename).catch(() => {
        exist = false;
    });
    if (exist) {
        const buff = await readFile(filename);
        return iconv.decode(buff, encoding);
    }
    if (!context.silent) console.log(`warnning: ${filename} file not found`);
    return '';
}

function LF2CRLF(str) {
    return str.replaceAll('\r', '').replaceAll('\n', '\r\n');
}

function CRLF2LF(str) {
    return str.split('\r\n').join('\n');
}

async function write_file(filename, content, { encoding, line_ending } = {}) {
    encoding ??= context.OE;
    line_ending ??= context.line_ending;
    await prepare_dir(dirname(filename));
    let buff = iconv.encode(line_ending == "CRLF" ? LF2CRLF(content) : CRLF2LF(content), encoding);
    await writeFile(filename, buff);
}

function compare_str(a, b) {
    if (a > b) return 1;
    if (a < b) return -1;
    return 0;
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
function pad_left(item, length, placeholder = ' ') {
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
function pad_right(item, length, placeholder = ' ') {
    return String(item).padEnd(length, placeholder).slice(0, length);
}

function fixed_hex(num, length) {
    const HEX = num instanceof Integer ? num.HEX : num?.toString(16);
    return pad_left(HEX, length, '0').toUpperCase();
}

function lazyassign(obj, prop, lazyvalue, options) {
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

export async function forEachAsync(arr, callback) {
    for (const item of arr) {
        await callback(item);
    }
}

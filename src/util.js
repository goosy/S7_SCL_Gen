import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, posix } from 'node:path';
import iconv from 'iconv-lite';
import pkg from '../package.json' with { type: 'json' };

export {
    context, CURRENT_DOC, CURRENT_NODE,
    is_plain_object, get_template,
    prepare_dir, copy_file, read_file, write_file,
    compare, multi_sort, get_object_prop,
    pad_left, pad_right, fixed_hex, parse_hex_array,
    elog,
};

const module_path = posix.join(import.meta.dirname.replace(/\\/g, '/').replace(/\\/g, '/'), "..");
const work_path = process.cwd().replace(/\\/g, '/');
const context = {
    module_path,
    work_path,
    version: pkg.version,
    output_zyml: false,
    no_convert: false,
    no_copy: false,
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
    const path = template_file ?? posix.join(module_path, 'src', 'converters', `${feature}.template`);
    const filename = posix.resolve(path);
    if (templates_cache.has(filename)) return templates_cache.get(filename);
    const template = await read_file(filename);
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
    const parents = dirname(dir);
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

async function _copy(src, dst) {
    if (typeof src !== 'string' || typeof dst !== 'string') return;
    const d = dst.endsWith('/') ? dst + basename(src) : dst;
    await prepare_dir(dirname(d));
    await cp(src, d, { recursive: true });
}

/**
 * Copy files
 * When the target is a folder, it ends with '/'
 * @param {string} src
 * @param {string|string[]} dst
 */
async function copy_file(src, dst) {
    if (Array.isArray(dst)) {
        // Asynchronous sequential execution
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
    const buff = iconv.encode(line_ending === "CRLF" ? LF2CRLF(content) : CRLF2LF(content), encoding);
    await writeFile(filename, buff);
}

/**
 * Compare two values
 * @param {*} a - value 1
 * @param {*} b - value 2
 * @param {boolean} [dec=false] - descending order
 * @returns {number} 1 if a > b, -1 if a < b, 0 if a === b
 */
function compare(a, b, dec = false) {
    if (typeof a !== typeof b) return 0;
    const factor = dec ? -1 : 1;
    if (a > b) return 1 * factor;
    if (a < b) return -1 * factor;
    return 0;
}

/**
 * Get the nested property value of an object
 * @param {Object} obj - target object
 * @param {string} path - property path, e.g. 'cpu.name'
 * @returns {*} - property value
 */
function get_object_prop(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current?.[key];
    }, obj);
}

/**
 * Custom sort
 * @param {Array} list - list
 * @param {Array} sort - sort rules
 */
function multi_sort(list, sort) {
    if (!Array.isArray(list)) return;
    if (!Array.isArray(sort)) return;
    while (sort.length) {
        const key = sort.pop();
        const dec = key.startsWith('@');
        const path = dec ? key.slice(1) : key;
        list.sort((a, b) => compare(get_object_prop(a, path), get_object_prop(b, path), dec));
    }
}

/**
 * Fill the left side of the item with placeholders to the specified length
 * If the item itself exceeds this length, intercept the substring of this length on the right side of the item
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
 * Fill the right side of the item with placeholders to the specified length
 * If the item itself exceeds this length, intercept the substring of this length on the left side of the item
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
    const HEX = num?.HEX ?? num?.toString(16) ?? 0;
    return pad_left(HEX, length, '0').toUpperCase();
}

function is_plain_object(obj) {
    if (obj === null || obj === undefined) return false;
    return Object.getPrototypeOf(obj) === Object.prototype;
}

/**
 * Parse a hexadecimal string into an array of bytes
 * @param {string|null} hex_string - string in hexadecimal format, each byte separated by a space
 * @param {string} [error_msg] - error message if the input string is illegal
 * @returns {string[]} - array of bytes, each byte is a 2-character hexadecimal string
 * @throws {SyntaxError} - if the input string is illegal
 */
function parse_hex_array(hex_string, error_msg) {
    if (hex_string == null) return [];
    const data_error = new SyntaxError(
        error_msg ??
        `wrong hex string 错误16进制字符串: "${hex_string}"
        must be a space-separated hexadecimal string
        必须是一个由空格分隔的16进制字符串`
    );
    assert.strictEqual(typeof hex_string, 'string', data_error);
    const str = hex_string.trim();
    assert(/^[0-9a-f]{2}( +[0-9a-f]{2})+$/i.test(str), data_error);
    return str.split(/ +/).map(byte => fixed_hex(byte, 2));
}

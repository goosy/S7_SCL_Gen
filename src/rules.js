import { dirname, posix, isAbsolute } from 'node:path';
import { isMatch } from 'matcher';
import {
    context, get_template, forEachAsync,
    read_file
} from './util.js';
import { parseAllDocuments } from 'yaml';

function isPlainObject(obj) {
    return Object.getPrototypeOf(obj) === Object.prototype;
}

export const match = (item, pattern_object) => {
    if (pattern_object === '*') return true; // * 匹配所有类型的值
    if (typeof item === 'boolean' && typeof pattern_object === 'boolean') {
        return item === pattern;
    }
    if (typeof item === 'string' && (
        typeof pattern_object === 'string' || Array.isArray(pattern_object)
    )) {
        return isMatch(item, pattern_object);
    }
    if (!isPlainObject(pattern_object) || !isPlainObject(item)) return false;
    for (const [key, pattern] of Object.entries(pattern_object)) {
        if (!match(item[key], pattern)) return false;
    }
    return true;
};

export const match_list = (list, pattern_object) => list.filter(item => match(item, pattern_object));

export const apply_rule = (item, rule) => {
    for (const [key, value] of Object.entries(rule.modifications)) {
        if (key == 'tags' && isPlainObject(value)) {
            // tags 浅复制
            item[key] ??= {};
            Object.assign(item[key], value);
            return;
        }
        if (key in item) {
            if (typeof value === 'string' || typeof value === 'boolean') {
                item[key] = value;
            } else {
                console.log(`rule error! action: ${key}:${value}`);
            }
        }
    }
};

export const apply_rules = (gen_list, rules) => {
    const matched_list = new Map();
    for (const rule of rules) {
        for (const item of gen_list) {
            if (match(item, rule.pattern)) {
                if (matched_list.has(item)) {
                    matched_list.get(item).push(rule);
                } else {
                    matched_list.set(item, [rule]);
                }
            }
        }
    }
    return gen_list.map(item => {
        const ret = { ...item };
        if (matched_list.has(item)) {
            const rules = matched_list.get(item);
            rules.forEach(rule => apply_rule(ret, rule));
        }
        return ret;
    });
};

function modify_path(modifications, base_path, attr) {
    const path = modifications[attr];
    if (path && typeof path === 'string') {
        if(isAbsolute(path)) return;
        modifications[attr] = posix.join(base_path, path);
    }
}

export const parse_rules = async (yaml, base_path) => {
    const documents = parseAllDocuments(yaml, { version: '1.2' });
    const tasks = [];
    await forEachAsync(documents, async doc => {
        const { configuration, rules: _rules } = doc.toJS();
        const path = isAbsolute(configuration) ? configuration : posix.join(base_path, configuration);
        const rules = [];
        await forEachAsync(_rules, async rule => {
            if (!isPlainObject(rule)) return; // 不正确的规则，返回空
            const pattern = rule.pattern;
            if (!pattern) return;
            if (!isPlainObject(pattern) && !Array.isArray(pattern) && typeof pattern !== 'string') return;
            const modifications = rule.modifications;
            if (!isPlainObject(modifications)) return;
            ['template', 'output_dir', 'output_file', 'src', 'source', 'dst', 'distance'].forEach(
                attr => modify_path(modifications, base_path, attr)
            );

            if (modifications.template) { // 读入模板
                modifications.template = await get_template(modifications.template);
            }
            rules.push(rule);
        });
        tasks.push({ path, rules });
    })
    return tasks;
}

/**
 * @typedef {Object} Task
 * @property {string} Task.path
 * @property {Rule[]} Task.rules
 */

/**
 * Retrieves and parses a set of rules from a YAML file.
 *
 * @param {string} filename - The path to the YAML file containing the rules.
 * @param {Object} [options={}] - Optional parameters for reading the file.
 * @param {string} [options.encoding='utf8'] - The encoding to use when reading the file.
 * @return {Promise<Array<Task>} A promise that resolves to the parsed rules.
 */
export const get_rules = async (filename, options = {}) => {
    const encoding = options.encoding ?? 'utf8';
    const yaml = await read_file(filename, { encoding });
    const base_path = dirname(filename).replace(/\\/g, '/');
    return await parse_rules(yaml, base_path);
}

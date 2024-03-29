import { isMatch } from 'matcher';
import { dirname, isAbsolute, posix } from 'node:path';
import { parseAllDocuments } from 'yaml';
import {
    forEachAsync,
    get_template,
    read_file
} from './util.js';
import { convert } from 'gooconverter';

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
    const MS = rule.modifications;
    for (let [key, value] of Object.entries(MS)) {
        if (value === null) {
            delete item[key];
            return;
        }
        if (key == 'tags' && isPlainObject(value)) {
            // tags 浅复制
            item[key] ??= {};
            Object.assign(item[key], value);
            return;
        }
        if (typeof value === 'boolean') {
            item[key] = value;
            return;
        }
        if (typeof value !== 'string') {
            console.log(`rule error! modification ${key}:${modi_value}`);
            return;
        }
        // substitution
        const new_value = key === 'template'
            ? value :
            convert({ ...item.tags, ...MS.tags }, value);
        item[key] = new_value;
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

function modify_path(modifications, attr, config_path) {
    const path = modifications[attr];
    if (path && typeof path === 'string') {
        if (isAbsolute(path)) return;
        modifications[attr] = posix.relative(config_path, path);
    }
}

export const parse_rules = async (yaml, rules_path) => {
    const documents = parseAllDocuments(yaml, { version: '1.2' });
    const tasks = [];
    await forEachAsync(documents, async doc => {
        const { config_path, rules: _rules, attributes } = doc.toJS();
        const path = posix.join(rules_path, config_path);  // 相对于当前路径，与 rules_path 相加
        const rules = [];
        await forEachAsync(_rules, async rule => {
            if (!isPlainObject(rule)) return; // 不正确的规则，返回空
            const pattern = rule.pattern;
            if (!pattern) return;
            if (!isPlainObject(pattern) && !Array.isArray(pattern) && typeof pattern !== 'string') return;
            const modifications = rule.modifications;
            if (!isPlainObject(modifications)) return;
            // 'input_dir', 'output_dir' 路径，必须相对于将来的配置路径，与 config_path 相减
            modify_path(modifications, 'input_dir', config_path);
            modify_path(modifications, 'output_dir', config_path);
            // 读入模板，因为在当前处理，路径相对于当前路径，与 rules_path 相加
            const template_file = modifications.template;
            if (template_file) {
                modifications.template = await get_template(
                    posix.join(rules_path, template_file)
                );
            }
            // modifications.tags 增加 attributes
            if (modifications.tags && !isPlainObject(modifications.tags)) modifications.tags = {};
            if (attributes) {
                modifications.tags = {
                    ...modifications.tags,
                    ...attributes
                };
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
    const rules_path = dirname(filename).replace(/\\/g, '/');
    return await parse_rules(yaml, rules_path);
}

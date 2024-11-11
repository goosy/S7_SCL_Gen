import { isMatch } from 'matcher';
import { dirname, isAbsolute, posix } from 'node:path';
import { parseAllDocuments } from 'yaml';
import { get_template, read_file } from './util.js';
import { convert } from 'gooconverter';

function isPlainObject(obj) {
    return Object.getPrototypeOf(obj) === Object.prototype;
}

export const match = (item, pattern_object) => {
    if (pattern_object === '*') return true; // Matches all types of values
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
    for (const [key, value] of Object.entries(MS)) {
        if (value === null) {
            delete item[key];
            return;
        }
        if (key === 'tags' && isPlainObject(value)) {
            // tags shallow copy
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
            ? value
            : convert({ ...item.tags, ...MS.tags }, value);
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
            for (const rule of matched_list.get(item)) {
                apply_rule(ret, rule);
            }
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
    for (const doc of documents) {
        const { config_path, rules: _rules, attributes } = doc.toJS();
        const path = posix.join(rules_path, config_path);  // Relative to the current path, added to rules_path
        const rules = [];
        for (const rule of _rules) {
            if (!isPlainObject(rule)) continue; // Incorrect rule, returns empty
            const pattern = rule.pattern;
            if (!pattern) continue;
            if (!isPlainObject(pattern) && !Array.isArray(pattern) && typeof pattern !== 'string') continue;
            const modifications = rule.modifications;
            if (!isPlainObject(modifications)) continue;
            // 'input_dir', 'output_dir' paths must be relative to the future configuration path, subtracted from config_path
            modify_path(modifications, 'input_dir', config_path);
            modify_path(modifications, 'output_dir', config_path);
            // Read in the template, because in the current process, the path is relative to the current path, and is added to rules_path
            const template_file = modifications.template;
            if (template_file) {
                modifications.template = await get_template(
                    posix.join(rules_path, template_file)
                );
            }
            // modifications.tags add attributes
            if (modifications.tags && !isPlainObject(modifications.tags)) modifications.tags = {};
            if (attributes) {
                modifications.tags = {
                    ...modifications.tags,
                    ...attributes
                };
            }
            rules.push(rule);
        }
        tasks.push({ path, rules });
    }
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

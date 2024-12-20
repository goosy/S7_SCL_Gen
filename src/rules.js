import { isMatch } from 'matcher';
import { dirname, isAbsolute, posix } from 'node:path';
import { parseAllDocuments } from 'yaml';
import { elog, get_template, read_file } from './util.js';
import { convert } from 'gooconverter';

function is_plain_object(obj) {
    if (obj === null || obj === undefined) return false;
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
    if (!is_plain_object(pattern_object) || !is_plain_object(item)) return false;
    for (const [key, pattern] of Object.entries(pattern_object)) {
        if (!match(item[key], pattern)) return false;
    }
    return true;
};

export const array_match = (list, pattern_object) => list.filter(item => match(item, pattern_object));

function merge_tags(merged_tags, tags) {
    if (!is_plain_object(merged_tags) || !is_plain_object(tags)) {
        elog(new TypeError('tags must be an object'));
    }

    for (const [key, value] of Object.entries(tags)) {
        if (merged_tags[key] === value) continue;
        if (key === 'files' || key === 'list') {
            const new_items = value ?? [];
            merged_tags[key] ??= [];
            merged_tags[key].push(...new_items); // @todo check duplication
            continue;
        }
        // the cpu_name, feature, and platform properties of tags will be assigned in apply_rule()
        if (['cpu_name', 'feature', 'platform'].includes(key)) continue;
        merged_tags[key] ??= value;
    }
}

/**
 * for the following attributes of merged_item, 
 * compare the corresponding attributes of merged_item and item:
 * - enable: it is true initially
 * - type: when it is inconsistent, set enable to false and stop merging
 * - template: when it is consistent, it will be the original value, otherwise set enable to false and stop merging.
 * - distance: when it is consistent, it will be the original value, otherwise set enable to false and stop merging.
 * - output_dir: when it is consistent, it will be the original value, otherwise set enable to false and stop merging.
 * - cpu: when it is consistent, it is the original value, if it is inconsistent, it is ''
 * - feature: when it is consistent, it is the original value, if it is inconsistent, it is ''
 * - platform: when it is consistent, it is the original value, if it is inconsistent, it is ''
 * - OE: when it is consistent, it is the original value, if it is inconsistent, it is 'utf8'
 * - line_ending: when is consistent, it will be the original value, if it is inconsistent, it will be 'LF'
 * - tags: merge item.tags to merged_item.tags. mainly merge attributes of files, list, includes and options
 * @param {object} merged_item 
 * @param {object} item 
 * @returns 
 */
function merge_item(merged_item, item) {
    merged_item.template ??= item.template;
    if (merged_item.template !== item.template) {
        merged_item.template = '';
    }

    merged_item.distance ??= item.distance;
    if (merged_item.distance !== item.distance) {
        merged_item.distance = '';
    }

    merged_item.output_dir ??= item.output_dir;
    if (merged_item.output_dir !== item.output_dir) {
        merged_item.output_dir = '';
    }

    merged_item.tags ??= {};
    merge_tags(merged_item.tags, item.tags);

    merged_item.cpu_name ??= item.cpu_name;
    if (merged_item.cpu_name !== item.cpu_name) {
        merged_item.cpu_name = '';
    }

    merged_item.feature ??= item.feature;
    if (merged_item.feature !== item.feature) {
        merged_item.feature = '';
    }

    merged_item.platform ??= item.platform;
    if (merged_item.platform !== item.platform) {
        merged_item.platform = '';
    }

    merged_item.OE ??= item.OE;
    if (merged_item.OE !== item.OE) {
        merged_item.OE = 'utf8';
    }

    merged_item.line_ending ??= item.line_ending;
    if (merged_item.line_ending !== item.line_ending) {
        merged_item.line_ending = 'LF';
    }
}

export async function apply_rule(item, modify) {
    // tags shallow copy
    item.tags ??= {};
    const tags = item.tags;
    if (is_plain_object(modify.tags)) merge_tags(item.tags, modify.tags);
    tags.cpu_name = modify.cpu_name ?? item.cpu_name;
    tags.feature = modify.feature ?? item.feature;
    tags.platform = modify.platform ?? item.platform;

    for (const [key, value] of Object.entries(modify)) {
        if (value === null) {
            delete item[key];
            continue;
        }
        if (key === 'tags') continue;
        if (key === 'input_dir' || key === 'output_dir') {
            if (typeof value !== 'string') continue;
            // 'input_dir', 'output_dir' paths must be relative to the rules path
            const path = convert(tags, value);
            item[key] = isAbsolute(path) ? path : posix.join(modify.rules_path, path);
            continue;
        }
        if (typeof value === 'boolean') {
            item[key] = value;
            continue;
        }
        if (typeof value !== 'string') {
            console.log(`rule error! modification ${key}:${value}`);
            continue;
        }
        if (key === 'template') {
            // Read in the template
            // the template path is relative to the rules_path
            const path = posix.join(modify.rules_path, convert(tags, modify.template));
            item.template = await get_template(path);
            continue;
        }
        // includes distance
        item[key] = convert(tags, value);
    }
};

export async function apply_rules(gen_list, rules) {
    const matched_rules = rules.map(rule => ({
        rule,
        items: array_match(gen_list, rule.pattern),
    }));
    const modification_dict = new Map();
    const merge_pairs = [];

    // all items in gen_list are of the same type
    // only convertion items can be merged
    const is_convertion = gen_list.length > 1 && gen_list[0].type === 'convert';

    for (const { rule, items } of matched_rules) {
        // merge items
        const merge = rule.merge;
        const mergeable = is_convertion && is_plain_object(merge);
        if (mergeable && rule.type && rule.type !== 'convert') {
            console.warn('Warning: The type value of merge rule must be "convert".');
        } else if (mergeable) {
            const item = { type: 'convert' };
            const ok = items.every(_item => {
                if (is_plain_object(_item)) {
                    merge_item(item, _item);
                    return true;
                }
                return false;
            });
            if (ok) merge_pairs.push({ item, merge });
        }

        // modification items
        const modification = rule.modify;
        for (const item of items) {
            if (item.deleted || modification === undefined) continue;
            if (modification === 'delete') {
                item.deleted = true;
                modification_dict.delete(item);
                continue;
            }
            if (modification_dict.has(item)) {
                modification_dict.get(item).push(rule);
            } else {
                modification_dict.set(item, [rule]);
            }
        }
    }

    // apply rules
    const modification_list = [];
    for (const item of gen_list) {
        if (item.deleted === true) continue;
        const ret = { ...item };
        if (modification_dict.has(item)) {
            for (const rule of modification_dict.get(item)) {
                await apply_rule(ret, rule.modify);
            }
        }
        modification_list.push(ret);
    }
    // apply_rule() must be called after merge_pairs is generated,
    // to ensure that the merge items are complete
    const merge_list = [];
    for (const { item, merge } of merge_pairs) {
        await apply_rule(item, merge);
        merge_list.push(item);
    }

    return [...modification_list, ...merge_list];
};

async function regularize(action, rules_path, attributes) {
    if (!is_plain_object(action)) return false;
    action.rules_path = posix.resolve(rules_path);
    // modify.tags add attributes
    if (!is_plain_object(action.tags)) action.tags = {};
    const tags = action.tags;
    Object.assign(tags, attributes);
    return true;
}

export async function parse_rules(yaml, rules_path) {
    const documents = parseAllDocuments(yaml, { version: '1.2' });
    const tasks = [];
    for (const doc of documents) {
        const { config_path, rules: _rules, attributes } = doc.toJS();
        const path = posix.join(rules_path, config_path);  // Relative to the current path, added to rules_path
        const rules = [];
        for (const rule of _rules) {
            // Incorrect rule, returns empty
            if (!is_plain_object(rule)) continue;
            const pattern = rule.pattern;
            if (!pattern) continue;
            if (
                !is_plain_object(pattern)
                && !Array.isArray(pattern)
                && typeof pattern !== 'string'
            ) continue;

            const modify = regularize(rule.modify, rules_path, attributes);
            const merge = regularize(rule.merge, rules_path, attributes);
            if (modify || merge) rules.push(rule);
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

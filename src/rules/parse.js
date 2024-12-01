import { dirname, posix } from 'node:path';
import { parseAllDocuments } from 'yaml';
import { is_plain_object, read_file } from '../util.js';

function regularize(action, rules_path, extra_tags) {
    const ret = action === 'delete' ? { action: 'delete' } : action;
    if (!is_plain_object(ret) || !ret.action) return [];
    if (action.action === 'delete') return ret;
    ret.rules_path = posix.resolve(rules_path);
    if (!is_plain_object(ret.tags)) ret.tags = {};
    Object.assign(ret.tags, extra_tags);
    return ret;
}

function parse_rules(yaml, rules_path) {
    const documents = parseAllDocuments(yaml, { version: '1.2' });
    return documents.flatMap(doc => {
        const js_object = doc.toJS();
        if (!is_plain_object(js_object)) return [];
        const config_path = (js_object.config_path ?? '.').replace(/\\/g, '/');
        const extra_tags = js_object.attributes ?? {};

        const _rules = js_object.rules ?? [];
        if (!Array.isArray(_rules)) return [];
        const rules = _rules.flatMap(rule => {
            // Incorrect rule, returns empty
            if (!is_plain_object(rule)) return [];
            const pattern = rule.pattern;
            const no_pattern = pattern == null;
            if (
                !no_pattern
                && !is_plain_object(pattern)
                && !Array.isArray(pattern)
                && typeof pattern !== 'string'
            ) return [];
            if (rule.actions === 'delete') rule.actions = [{ action: 'delete' }];
            if (!Array.isArray(rule.actions)) return [];

            let has_delete = false;
            const actions = rule.actions.flatMap(_action => {
                const action = regularize(_action, rules_path, extra_tags);
                if (action.action === 'delete') has_delete = true;
                if (no_pattern && action.action !== 'add') {
                    console.warn('No pattern, but action is not "add", ignored');
                    return [];
                }
                return action;
            });
            if (actions.length === 0) return [];
            if (!has_delete) {
                rule.actions = actions;
                return rule;
            }
            rule.actions = actions.filter(
                action => action.action !== 'replace' && action.action !== 'join'
            );
            return rule;
        });
        if (rules.length === 0) return [];

        const path = posix.join(rules_path, config_path);  // Relative to the current path, added to rules_path
        return { path, rules }; // return a task
    });
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
async function get_rules(filename, options = {}) {
    const encoding = options.encoding ?? 'utf8';
    const yaml = await read_file(filename, { encoding });
    const rules_path = dirname(filename).replace(/\\/g, '/');
    return parse_rules(yaml, rules_path);
}

export { get_rules, parse_rules };

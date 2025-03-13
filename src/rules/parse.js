import { dirname, posix } from 'node:path';
import { parseAllDocuments } from 'yaml';
import { is_plain_object, read_file } from '../util.js';

function regularize(action, rules_path, extra_tags, using_inner_rules) {
    const action_type = action.action_type;
    // Document rules do not support "merge" or "inner_rules" action
    if (using_inner_rules && (action_type === 'merge' || action_type === 'inner_rules')) {
        console.warn('merge or inner_rules action is not allowed in inner_rules, ignored');
        return [];
    }
    const ret = Array.isArray(action)
        ? { action_type: 'inner_rules', rules: action } // array is treated as inner_rules
        : action === 'delete' ? { action_type: 'delete' } : action;
    if (!is_plain_object(ret)) return [];
    ret.action_type ??= Array.isArray(ret.rules) ? 'inner_rules' : 'replace'; // default action type
    ret.action_scope ??= 'matched'; // default action scope
    // delete and merge action only works on matched items
    if ((ret.action_type === 'delete' || ret.action_type === 'merge') && ret.action_scope !== 'matched') {
        console.warn('delete and merge action only works on matched items, ignored');
        return [];
    }
    if (ret.action_type === 'delete') return ret;
    ret.rules_path = posix.resolve(rules_path);
    if (!is_plain_object(ret.tags)) ret.tags = {};
    if (is_plain_object(extra_tags)) Object.assign(ret.tags, extra_tags);
    return ret;
}

function _parse_rules(rules_raw, extra_tags, rules_path, using_inner_rules = false) {
    return rules_raw.flatMap(rule => {
        // Incorrect rule, returns empty
        if (!is_plain_object(rule)) return [];
        const sort_by = rule.sort_by;
        if (sort_by) return { sort_by };
        const pattern = rule.pattern;
        const no_pattern = pattern == null;
        if (
            !no_pattern
            && !is_plain_object(pattern)
            && !Array.isArray(pattern)
            && typeof pattern !== 'string'
        ) return [];
        rule.scope ??= 'applied';
        if (rule.actions === 'delete') rule.actions = [{ action_type: 'delete' }];
        if (!Array.isArray(rule.actions)) return [];

        let has_delete = false;
        let has_inner_rules = false;
        const actions = rule.actions.flatMap(_action => {
            if (_action == null) { // ignore null actions
                console.warn('Null action is illegal, ignored');
                return [];
            }
            const action_type = _action.action_type;
            // Ensure that no pattern action can only be "add"
            if (no_pattern && action_type !== 'add') {
                console.warn('No pattern, but action is not "add", ignored');
                return [];
            }
            // Ensure that the inner_rules action is executed only once in the same rule
            if (!using_inner_rules && has_inner_rules && action_type === 'inner_rules') {
                console.warn('Only one "inner_rules" action is allowed, ignored');
                return [];
            }
            // Ensure that the delete action is executed only once and before any other action in the same rule
            if (has_delete) {
                console.warn('A "delete" action already exists, rest actions will be ignored');
                return [];
            }
            const action = regularize(_action, rules_path, extra_tags, using_inner_rules);
            if (action.action_type === 'delete') has_delete = true;
            if (action.action_type === 'inner_rules') has_inner_rules = true;
            return action;
        });

        rule.actions = actions.flatMap(action => {
            const type = action.action_type;
            const scope = action.action_scope;
            // If there is a delete action, remove replace, join or inner_rules action with matched scope
            if (
                has_delete && scope === 'matched' &&
                (type === 'replace' || type === 'join' || type === 'inner_rules')
            ) {
                return [];
            }
            const rules = action.rules;
            if (type === 'inner_rules' && Array.isArray(rules)) {
                action.rules = _parse_rules(rules, extra_tags, rules_path, true);
            }
            return action;
        });

        if (rule.actions.length === 0) return [];
        return rule;
    });
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
        const rules = _parse_rules(_rules, extra_tags, rules_path);
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

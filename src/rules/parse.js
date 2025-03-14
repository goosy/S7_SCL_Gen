import { dirname, posix } from 'node:path';
import { parseAllDocuments } from 'yaml';
import { is_plain_object, read_file } from '../util.js';

async function regularize(action, rules_path, attributes) {
    if (!is_plain_object(action)) return false;
    action.rules_path = posix.resolve(rules_path);
    // modify.tags add attributes
    if (!is_plain_object(action.tags)) action.tags = {};
    const tags = action.tags;
    Object.assign(tags, attributes);
    return true;
}

async function parse_rules(yaml, rules_path) {
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
async function get_rules(filename, options = {}) {
    const encoding = options.encoding ?? 'utf8';
    const yaml = await read_file(filename, { encoding });
    const rules_path = dirname(filename).replace(/\\/g, '/');
    return await parse_rules(yaml, rules_path);
}

export { get_rules, parse_rules };

import { posix, resolve } from 'node:path';
import { convert } from 'gooconverter';
import { elog, get_template, is_plain_object } from '../util.js';
import { match_all } from './match.js';

async function modify(obj, modification, { tags, action_type }) {
    // for boolean and number
    if (typeof modification === 'boolean' || typeof modification === 'number') {
        return modification;
    }

    // for Array and Object
    if (Array.isArray(modification)) {
        return await modify_array(obj, modification, { tags, action_type });
    }
    if (is_plain_object(modification)) {
        return await modify_object(obj, modification, { tags, action_type });
    }

    // do replace directly if the modification is not one of the boolean number plain_object array
    // join action_type will ignore, and no substitution
    if (typeof modification !== 'string') {
        return modification;
    }

    // for String
    const ret = tags === null ? modification : convert(tags, modification);

    // boolean literal
    const orig_str = ret.toLowerCase();
    if (typeof obj === 'boolean' && (orig_str === 'true' || orig_str === 'false')) {
        return orig_str === 'true';
    }

    return ret;
}

async function modify_array(arr, modification, { tags, action_type }) {
    const original = arr != null && action_type === 'join'
        ? Array.isArray(arr) ? arr : [arr]
        : [];
    for (const sub_modi of modification) {
        const item = await modify(null, sub_modi, { tags, action_type });
        original.push(item);
    }
    return original;
}

async function modify_object(obj, modification, { tags, action_type, is_item = false }) {
    if (!is_plain_object(modification)) return modification;
    const original = is_item ? obj : (is_plain_object(obj) && action_type === 'join' ? obj : {});
    for (const [key, value] of Object.entries(modification)) {
        if (value == null) {
            delete original[key];
            continue;
        }
        const property = action_type === 'join' ? original[key] : null;
        original[key] = await modify(property, value, { tags, action_type });
    }
    return original;
}

/**
 * Modifies the given object based on the provided modification.
 *
 * @param {Object} item - The original object to be modified.
 * @param {Object} modification - The modification object that contains changes to be applied.
 * @param {Object} [options] - Additional options for modification.
 * @param {Object} [options.tags={}] - Tags used for template substitution within modifications.
 * @param {string} [options.action_type='replace'] - Specifies the type of action to perform: 'replace' or 'join'.
 * @returns {Promise<Object|null>} - Returns the modified object or null if modification is not applicable.
 */
async function modify_item(item, modification, { tags = {}, action_type = 'replace' } = {}) {
    if (!is_plain_object(modification)) return null;
    if (!is_plain_object(item)) return null;
    return modify_object(item, modification, { tags, action_type, is_item: true });
}

/**
 * merge the following attributes of merged_item, 
 * compare the corresponding attributes of merged_item and item:
 * - type: must be 'convert', or stop merging
 * - template: when it is consistent, it will be the original value, otherwise set it to empty string.
 * - distance: when it is consistent, it will be the original value, otherwise set it to empty string.
 * - output_dir: when it is consistent, it will be the original value, otherwise set it to empty string.
 * - cpu: when it is consistent, it is the original value, otherwise set it to empty string.
 * - feature: when it is consistent, it is the original value, otherwise set it to empty string.
 * - platform: when it is consistent, it is the original value, otherwise set it to empty string.
 * - OE: when it is consistent, it is the original value, otherwise set it to 'utf8'
 * - line_ending: when is consistent, it will be the original value, otherwise set it to 'LF'
 * - tags: merge item.tags to merged_item.tags. mainly merge attributes of files, list, includes and options
 * @param {object} merged_item
 * @param {object} item 
 * @returns 
 */
async function merge_item(merged_item, item) {
    if (!is_plain_object(item)) {
        return false;
    }

    if (item.type !== 'convert') { // is not a GCL item
        return false;
    }

    await update_tags(merged_item, item.tags);

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

    return true;
}

async function update_tags(item, modi_tags) {
    // the cpu_name, feature, and platform properties of tags will be assigned in apply_action()
    const { cpu_name, feature, platform, ...modification } = modi_tags ?? {};
    const tags = item.tags ?? {};
    tags.files ??= [];
    tags.list ??= [];
    await modify_object(tags, modification, { tags: {}, action_type: 'join' });
    item.tags = tags;
}

function get_modification(action) {
    const {
        action_type, action_scope, action_target,
        rules_path, tags,
        cpu_name, feature, platform,
        input_dir, output_dir, template,
        ...modification
    } = action;
    return modification;
}

export async function apply_action(item, action, using_inner_rules = false) {
    const action_type = action.action_type;
    if (action_type === 'inner_rules') {
        // @TODO
        // item.tags.list = await apply_rules(item.tags.list, action.rules, true);
        return { error: null };
    }

    const target = action.action_target;
    if (item !== target) { // a add action or the 1st phase of a merge action
        const ret = await merge_item(target, item);
        // if the merge action failed
        const error = ret === false ? 'merge action failed' : null;
        // the 1st phase of a merge action doesn't need modification
        if (action_type === 'merge') return { error };
    }

    await update_tags(item, action.tags);
    const tags = item.tags;
    tags.$ = item; // the original item

    if (!using_inner_rules) {
        for (const prop of ['cpu_name', 'feature', 'platform']) {
            const value = action[prop];
            if (value == null) continue;
            const substituted_value = convert(tags, value);
            target[prop] = substituted_value;
            tags[prop] = substituted_value;
        }
        for (const prop of ['input_dir', 'output_dir']) {
            const value = action[prop];
            if (typeof value !== 'string') continue;
            const path = convert(tags, value);
            // 'input_dir', 'output_dir' paths must be relative to the rules path
            target[prop] = resolve(action.rules_path, path).replace(/\\/g, '/');
        }
        if (typeof action.template === 'string') {
            const file = convert(tags, action.template).replace(/\\/g, '/');
            // Read in the template
            // the template path is relative to the rules_path
            const path = posix.resolve(action.rules_path, file);
            target.template = await get_template(path);
        }
    }

    const ret = await modify_item(
        target,
        get_modification(action),
        { tags, action_type }
    );
    return { error: ret === null ? 'apply action failed' : null };
};

class Flag_Map extends Map {
    set(item) {
        super.set(item, true);
    }
    reset(item) {
        super.set(item, false);
    }
    get(item) {
        return super.has(item) && super.get(item);
    }
}
const deletions = new Flag_Map();

/**
 * Filter the original list according to rules and perform operations on matched items
 *
 * There are 2 types of rules:
 * 
 * - `main rule`: A main rule includes pattern, actions, and doc_rules attributes.
 * - `document rule`: Document rules are the doc_rules attribute of the main rule.
 *
 * Each rule's pattern property is an object. Only items matching all pattern's attribute expressions will be filtered
 * 
 * When a pattern's attribute is a string and has one of the following values, it represents special matching:
 * - '*' matches any non-null item
 * - '%u' matches null items
 * - `%b` matches any boolean item
 * - `%s` matches any string item
 * - `%n` matches any number item
 * - '%a' matches any array item
 * - '%o' matches any object item
 * 
 * When a pattern's attribute is a string but not a special matching pattern:
 * - Regular string represents positive string matching:
 *   `cpu_name: AS*` matches items where CPU name starts with AS
 * - String starting with ! represents negative string matching:
 *   `cpu_name: '!AS1'` matches items where CPU name is not AS1
 * 
 * When a pattern's attribute is a string array, it represents a multi-pattern matching mode.
 * The final result must satisfy all negative matches and at least one positive match
 * - Positive matches form a union
 *   `feature: [AI, alarm]` matches items with feature AI or alarm
 * - Negative matches form an intersection
 *   `cpu_name: ['!AS1', '!AS2']` matches items where CPU name is neither AS1 nor AS2
 * - When both positive and negative matches exist, result is (positive match union ⋂ negative match intersection)
 *   `cpu_name: ['AS*', '!*2', '!*3']` matches items where CPU name starts with AS but doesn't end with 2 or 3
 * 
 * Each rule's action is one of these 5 types (Document rules do not support merge operations):
 * - replace
 *     Replace matched item's properties with action's properties, including arrays (like files list)
 * - join
 *     Combine matched item's properties with action's properties, for arrays (like files list) append elements
 * - merge
 *     Merge matched convert items into a new convert item, following these rules:
 *     Action values take precedence in all rules below
 *     - Merge action only works for convert items, otherwise merge is cancelled. Convert items have type value 'convert'
 *     - Tags are merged using join mode, action's tags are joined into final tags
 *     - enable is set to true
 *     - For CPU\feature\platform: action value takes precedence, if consistent keep original value, if inconsistent use ''
 *     - For OE: action value takes precedence, if consistent keep original value, if inconsistent use 'utf8'
 *     - For line_ending: action value takes precedence, if consistent keep original value, if inconsistent use 'LF'
 *     - For template: action value takes precedence, if consistent keep original value, if inconsistent cancel merge
 *     - For distance: action value takes precedence, if consistent keep original value, if inconsistent cancel merge
 *     - For output_dir: action value takes precedence, if consistent keep original value, if inconsistent cancel merge
 * - add
 *     Add copy or convert items
 *     Create one or more new copy or convert items based on action values
 *     New items are defined in action's items, each item's properties can use template substitution
 *     Template expressions can reference matched item using item variable
 *     When rule has no pattern, creates items independent of matches, item variable unavailable
 * - delete
 *     Remove matched items from list and ignore remaining actions
 *     Matched items will not be converted or copied
 *     Recommended to only use merge or add actions before delete
 * - inner_rules
 *     Used to transform nested lists within document items.
 *     This action has a rules attribute that defines the document rules list.
 *     Document rules are similar to global rules but do not support merge or inner_rules actions.
 * 
 * Merge action creates new items without affecting original items, which continue independent conversion or copying
 * If original items are not needed after merge, use delete action separately
 * 
 * @param {Object[]} list - List of data to convert
 * @param {Object[]} rules - List of rules to apply
 * @param {boolean} using_inner_rules - True if rules are for document
 * @returns {Promise<Object[]>} - A promise that resolves to a list of data after applying rules
 */
export async function apply_rules(list, rules, using_inner_rules = false) {

    const applied_list = new Set(list);

    // all items in gen_list are of the same type
    // only convertion items can be merged
    const item_type = list.length > 0 && list[0].type === 'convert' ? 'convert' : 'copy';

    for (const rule of rules) {
        // matched_items can be matched from list or applied_list generated by previous rules
        const source_items = rule.scope == 'origin' ? list : applied_list;
        const { pattern, actions } = rule;
        // null matched_items is for add action
        const matched_items = pattern == null ? null : match_all(source_items, pattern);
        // Initialize merged_items and new_items for each rule to empty arrays
        const merged_items = [];
        const new_items = [];
        // A scope dictionary, used to specify the scope for each action
        const scope_dict = {
            matched: matched_items,
            merged: merged_items,
            new: new_items,
            get all() { return [...matched_items, ...merged_items, ...new_items] }
        };

        action_loop: for (const action of actions) {
            if (action === undefined) continue;
            const { action_type, action_scope } = action;
            const scope = scope_dict[action_scope];
            switch (action_type) {
                case 'delete':
                    for (const item of matched_items) {
                        deletions.set(item);
                        applied_list.delete(item);
                    }
                    break;
                case 'merge': // merge scope
                    // Only convertion items can be merged
                    if (item_type !== 'convert' || matched_items.length === 0 || using_inner_rules) break;
                    const merged_item = {};
                    // The merge action is divided into two phases.
                    // The first phase is to merge with each matching item,
                    // and the second phase is to merge the action attributes.
                    // all execution of the action must be executed after the previous action is executed
                    const phase1_action = { action_type, action_target: merged_item };
                    const phase2_action = { ...action, action_target: merged_item };
                    for (const item of matched_items) {
                        // The first phase: merge(merged_item, item)
                        const ret = await apply_action(item, phase1_action, using_inner_rules);
                        if (ret.error) continue action_loop;
                    }
                    // The second phase: merge action attributes
                    const ret = await apply_action(merged_item, phase2_action, using_inner_rules);
                    if (ret.error) continue;
                    merged_items.push(merged_item);
                    applied_list.add(merged_item);
                    break;
                case 'add': // add scope
                    if (item_type !== action.type) break;
                    const items = scope == null ? [{}] : scope;
                    for (const item of items) {
                        const new_item = {};
                        new_items.push(new_item);
                        action.action_target = new_item;
                        const ret = await apply_action(item, action, using_inner_rules);
                        if (!ret.error) applied_list.add(new_item);
                    }
                    break;
                case 'replace':
                case 'join':
                case 'inner_rules':
                    // modification scope
                    for (const item of scope) {
                        action.action_target = item;
                        const ret = await apply_action(item, action, using_inner_rules);
                        if (!deletions.get(item) && !ret.error) applied_list.add(item);
                    }
                    break;
                default:
                    break;
            }
        }
    }

    return applied_list;
}

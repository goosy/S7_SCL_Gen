import { posix, resolve } from 'node:path';
import { convert } from 'gooconverter';
import { elog, get_template, is_plain_object } from '../util.js';
import { match_all } from './match.js';

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
        // the cpu_name, feature, and platform properties of tags will be assigned in apply_action()
        if (['cpu_name', 'feature', 'platform'].includes(key)) continue;
        merged_tags[key] ??= value;
    }
}

async function modify_item(item, modification, { tags = {}, action_type = 'replace' } = {}) {
    const do_action = async (orig, modification) => {
        if (typeof modification === 'boolean') {
            return modification;
        }

        // for Array and Object
        let ret = orig;
        if (Array.isArray(modification) && orig == null) {
            ret = [];
        }
        if (is_plain_object(modification) && orig == null) {
            ret = {};
        }
        if (Array.isArray(ret) && Array.isArray(modification)) {
            return await modify_item(ret, modification, { action_type, tags });
        }
        if (is_plain_object(ret) && is_plain_object(modification)) {
            return await modify_item(
                ret,
                modification,
                { action_type, tags }
            );
        }

        // for String
        if (typeof modification !== 'string') {
            console.log(`rule error! modification ${modification}`);
            return orig;
        }
        const substituted_value = convert(tags, modification);

        if (
            typeof modification === 'boolean' &&
            (substituted_value === 'true' || substituted_value === 'false')
        ) {
            return substituted_value === 'true';
        }

        // includes distance
        return substituted_value;
    }

    // do array
    if (Array.isArray(modification)) {
        const orig = action_type === 'join'
            ? Array.isArray(item) ? item : [item]
            : [];
        for (const sub_modi of modification) {
            const item = await do_action(null, sub_modi);
            orig.push(item);
        }
        return orig;
    }
    // do object
    if (is_plain_object(modification)) {
        const orig = !is_plain_object(item) && action_type !== 'join' ? {} : item;
        for (const [key, value] of Object.entries(modification)) {
            if (value === null) {
                delete orig[key];
                continue;
            }
            const orig_prop = action_type === 'join' ? orig[key] : null;

            // if (Array.isArray(value)) console.log(orig[key], orig_prop, value)
            orig[key] = await do_action(orig_prop, value);
        }
        return orig;
    }

    return null;
}

function parse_modification(action) {
    const {
        action: _, rules_path, tags,
        cpu_name, feature, platform,
        input_dir, output_dir, template,
        ...modification
    } = action;
    return modification;
}

export async function apply_action(item, action) {
    const action_type = action.action;
    const applied_item = action_type === 'add' ? {} : item;
    // tags shallow copy
    applied_item.tags ??= {};
    const tags = applied_item.tags;
    if (is_plain_object(action.tags)) merge_tags(applied_item.tags, action.tags);
    tags.$ = item; // the original item

    for (const prop of ['cpu_name', 'feature', 'platform']) {
        const value = action[prop];
        if (value == null) continue;
        const substituted_value = convert(tags, value);
        applied_item[prop] = substituted_value;
        tags[prop] = substituted_value;
    }
    for (const prop of ['input_dir', 'output_dir']) {
        const value = action[prop];
        if (typeof value !== 'string') continue;
        const path = convert(tags, value);
        // 'input_dir', 'output_dir' paths must be relative to the rules path
        applied_item[prop] = resolve(action.rules_path, path).replace(/\\/g, '/');
    }
    if (typeof action.template === 'string') {
        const file = convert(tags, action.template).replace(/\\/g, '/');
        // Read in the template
        // the template path is relative to the rules_path
        const path = posix.resolve(action.rules_path, file);
        applied_item.template = await get_template(path);
    }
    return await modify_item(
        applied_item,
        parse_modification(action),
        { tags, action_type }
    );
};

class Merge_Item {
    item = { type: 'convert' };
    #action;
    get action() { return this.#action; }
    #error = false;
    get error() { return this.#error; }
    constructor(action) {
        this.#action = action;
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
     * @param {object} item 
     * @returns 
     */
    merge(item) {
        if (!is_plain_object(item)) {
            this.#error = true;
            return;
        }

        this.item.template ??= item.template;
        if (this.item.template !== item.template) {
            this.item.template = '';
        }

        this.item.distance ??= item.distance;
        if (this.item.distance !== item.distance) {
            this.item.distance = '';
        }

        this.item.output_dir ??= item.output_dir;
        if (this.item.output_dir !== item.output_dir) {
            this.item.output_dir = '';
        }

        this.item.tags ??= {};
        merge_tags(this.item.tags, item.tags);

        this.item.cpu_name ??= item.cpu_name;
        if (this.item.cpu_name !== item.cpu_name) {
            this.item.cpu_name = '';
        }

        this.item.feature ??= item.feature;
        if (this.item.feature !== item.feature) {
            this.item.feature = '';
        }

        this.item.platform ??= item.platform;
        if (this.item.platform !== item.platform) {
            this.item.platform = '';
        }

        this.item.OE ??= item.OE;
        if (this.item.OE !== item.OE) {
            this.item.OE = 'utf8';
        }

        this.item.line_ending ??= item.line_ending;
        if (this.item.line_ending !== item.line_ending) {
            this.item.line_ending = 'LF';
        }
    }

}

function perpare_merge_item(merged_items, action, items) {
    const merge_item = new Merge_Item(action);
    for (const item of items) {
        merge_item.merge(item);
        if (merge_item.error) return;
    }
    merged_items.push(merge_item);
}

function perpare_new_item(new_items, action, items, type) {
    if (type !== action.type) return;
    if (items == null) {
        new_items.push({ item: {}, action });
        return;
    }
    for (const item of items) {
        new_items.push({ item, action });
    }
}

export async function apply_rules(list, rules) {
    const items_per_rule = new Map();
    for (const rule of rules) {
        if (rule.pattern == null) {
            // There may be an empty pattern here, used for add actions
            items_per_rule.set(rule, null);
        } else {
            items_per_rule.set(rule, match_all(list, rule.pattern));
        }
    }
    const modi_actions = new Map();
    const new_items = [];
    const merged_items = [];

    // all items in gen_list are of the same type
    // only convertion items can be merged
    const is_convertion = list.length > 1 && list[0].type === 'convert';

    for (const [rule, items] of items_per_rule) {
        for (const action of rule.actions) {
            if (action === undefined) continue;
            const mergeable = is_convertion && is_plain_object(action);
            switch (action.action) {
                case 'delete':
                    for (const item of items) {
                        item.deleted = true;
                        modi_actions.delete(item);
                    }
                    break;
                case 'merge': // merge items
                    if (!mergeable) break;
                    perpare_merge_item(merged_items, action, items);
                    break;
                case 'add': // add items
                    perpare_new_item(
                        new_items, action, items,
                        is_convertion ? 'convert' : 'copy'
                    );
                    break;
                case 'replace':
                case 'join':
                    // modification items
                    for (const item of items) {
                        if (item.deleted) continue;
                        if (modi_actions.has(item)) {
                            modi_actions.get(item).push(action);
                        } else {
                            modi_actions.set(item, [action]);
                        }
                    }
                    break;
                default:
                    break;
            }
        }
    }

    const applied_list = [];
    // modification rules
    for (const item of list) {
        if (item.deleted === true) continue;
        const ret = { ...item };
        if (modi_actions.has(item)) {
            for (const action of modi_actions.get(item)) {
                await apply_action(ret, action, item.rules_path);
            }
        }
        applied_list.push(ret);
    }

    // add new items applied by `add` and `merge` actions
    // apply_action() with the merge rules must be called after merged_items is generated,
    // to ensure that the merge items are complete
    for (const { item, action } of [...new_items, ...merged_items]) {
        const new_item = await apply_action(item, action);
        applied_list.push(new_item);
    }

    return applied_list;
}

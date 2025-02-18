import { posix, resolve } from 'node:path';
import { convert } from 'gooconverter';
import { match_all } from './match.js';
import { elog, get_template, is_plain_object } from '../util.js';

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

export async function apply_action(item, action) {
    const applied_item = action.action === 'add' ? {} : item;
    // tags shallow copy
    applied_item.tags ??= {};
    const tags = applied_item.tags;
    if (is_plain_object(action.tags)) merge_tags(applied_item.tags, action.tags);
    tags.$ = item; // the original item
    const { cpu_name, feature, platform } = action;
    if (cpu_name) {
        const ret = convert(tags, cpu_name);
        applied_item.cpu_name = ret;
        tags.cpu_name = ret;
    }
    if (feature) {
        const ret = convert(tags, feature);
        applied_item.feature = ret;
        tags.feature = ret;
    }
    if (platform) {
        const ret = convert(tags, platform);
        applied_item.platform = ret;
        tags.platform = ret;
    }

    for (const [key, value] of Object.entries(action)) {
        if (value === null) {
            delete applied_item[key];
            continue;
        }
        if (['tags', 'cpu_name', 'feature', 'platform', 'action'].includes(key)) continue;

        if (key === 'input_dir' || key === 'output_dir') {
            if (typeof value !== 'string') continue;
            const path = convert(tags, value);
            // 'input_dir', 'output_dir' paths must be relative to the rules path
            applied_item[key] = resolve(action.rules_path, path).replace(/\\/g, '/');
            continue;
        }
        if (typeof value === 'boolean') {
            applied_item[key] = value;
            continue;
        }

        if (typeof value !== 'string') {
            console.log(`rule error! modification ${key}:${value}`);
            continue;
        }
        const substituted_value = convert(tags, value);

        if (substituted_value === 'true' || substituted_value === 'false') {
            applied_item[key] = substituted_value === 'true';
            continue;
        }
        if (key === 'template') {
            // Read in the template
            // the template path is relative to the rules_path
            const path = posix.join(action.rules_path, substituted_value);
            applied_item.template = await get_template(path);
            continue;
        }
        // includes distance
        applied_item[key] = substituted_value;
    }

    return applied_item;
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

function perpare_new_item(new_items, action, items) {
    // @todo
}

export async function apply_rules(list, rules) {
    const items_per_rule = new Map();
    for (const rule of rules) {
        items_per_rule.set(rule, match_all(list, rule.pattern));
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
                    perpare_new_item(new_items, action, items);
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
                await apply_action(ret, action);
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

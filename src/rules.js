import { isMatch } from 'matcher';

export const match = (item, pattern_object) => {
    for (const [key, pattern] of Object.entries(pattern_object)) {
        const _value = item[key];
        if (typeof _value === 'boolean' && typeof pattern === 'boolean') {
            if (_value !== pattern) return false;
        }
        if (typeof _value === 'string' && (typeof pattern === 'string' || Array.isArray(pattern))) {
            if (!isMatch(_value, pattern)) return false;
        }
    }
    return true;
};

export const match_list = (list, pattern_object) => list.filter(item => match(item, pattern_object));

export const apply_rule = (item, rule) => {
    for (const [key, value] of Object.entries(rule.actions)) {
        if (key in item) {
            item[key] = value;
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

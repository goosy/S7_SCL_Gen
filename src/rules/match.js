import { isMatch } from 'matcher';
import { is_plain_object } from '../util.js';

export function match(item, pattern_object) {
    if (pattern_object === '*') return true; // Matches all values ​​except null undefined
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
}

export function match_all(list, pattern_object) {
    return list.filter(item => match(item, pattern_object));
}

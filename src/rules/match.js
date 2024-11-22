import { isMatch } from 'matcher';
import { is_plain_object } from '../util.js';

export function match(item, pattern_object) {
    if (pattern_object == null) return false;
    if (item == null) {
        if (pattern_object === '%u') return true;
        return false;
    }
    if (pattern_object === '*') return true; // Matches all values ​​except null undefined
    if (typeof item === 'boolean') {
        if (pattern_object === '%b') return true;
        if (typeof pattern_object === 'boolean') return item === pattern;
    }
    if (typeof item === 'string') {
        if (pattern_object === '%s') return true;
        if (typeof pattern_object === 'string' || Array.isArray(pattern_object)) {
            return isMatch(item, pattern_object);
        }
        return false;
    }
    if (typeof item === 'number') {
        if (pattern_object === '%n') return true;
        if (typeof pattern_object === 'number') {
            return item === pattern_object;
        }
        return false;
    }
    if (Array.isArray(item)) {
        if (pattern_object === '%a') return true;
        return item.some(_item => match(_item, pattern_object));
    }
    if (is_plain_object(item)) {
        if (pattern_object === '%o') return true;
        if (!is_plain_object(pattern_object)) return false;
        for (const [key, pattern] of Object.entries(pattern_object)) {
            if (!match(item[key], pattern)) return false;
        }
        return true;
    }
    return false;
}

export function match_all(list, pattern_object) {
    if(pattern_object == null) return [];
    return list.filter(item => match(item, pattern_object));
}

import { isMatch } from 'matcher';
import { is_plain_object } from '../util.js';

export function match(obj, pattern_object) {
    if (pattern_object == null) return false;
    if (obj == null) {
        if (pattern_object === '%u') return true;
        return false;
    }
    if (pattern_object === '*') return true; // Matches all values ​​except null undefined
    if (typeof obj === 'boolean') {
        if (pattern_object === '%b') return true;
        if (typeof pattern_object === 'boolean') return obj === pattern_object;
    }
    if (typeof obj === 'string') {
        if (pattern_object === '%s') return true;
        if (typeof pattern_object === 'string' || Array.isArray(pattern_object)) {
            return isMatch(obj, pattern_object);
        }
        return false;
    }
    if (typeof obj === 'number') {
        if (pattern_object === '%n') return true;
        if (typeof pattern_object === 'number') {
            return obj === pattern_object;
        }
        return false;
    }
    if (Array.isArray(obj)) {
        if (pattern_object === '%a') return true;
        return obj.some(_item => match(_item, pattern_object));
    }
    if (is_plain_object(obj)) { // plain object
        if (pattern_object === '%o') return true;
        if (!is_plain_object(pattern_object)) return false;
    }
    if (pattern_object === '%O') return true;
    // an object includes plain object
    for (const [key, pattern] of Object.entries(pattern_object)) {
        if (!match(obj[key], pattern)) return false;
    }
    return true;
}

export function match_all(list, pattern_object) {
    if (pattern_object == null) return [];
    return [...list].filter(item => match(item, pattern_object));
}

import assert from 'assert/strict';

/**
 * 将item左侧用占位符填充至指定长度
 * 如果item本身超过该长度，则截取item右侧该长度子串
 * @date 2021-11-17
 * @param {number|string} item
 * @param {number} length
 * @param {string} placeholder=''
 * @returns {string}
 */
export function pad_left(item, length, placeholder = ' ') {
    return String(item).padStart(length, placeholder).slice(-length);
}
/**
 * 将item右侧用占位符填充至指定长度
 * 如果item本身超过该长度，则截取item左侧该长度子串
 * @date 2021-11-17
 * @param {number|string} item
 * @param {number} length
 * @param {string} placeholder=''
 * @returns {string}
 */
export function pad_right(item, length, placeholder = ' ') {
    return String(item).padEnd(length, placeholder).slice(0, length);
}

export function fixed_hex(num, length) {
    const HEX = num instanceof INT ? num.HEX : num?.toString(16);
    return pad_left(HEX, length, '0').toUpperCase();
}

class S7Value {
    _value;
    get value() {
        return this._value;
    }
    toString(...paras) {
        return this._value.toString(...paras);
    }
}

export class BOOL extends S7Value {
    constructor(value) {
        super();
        if (value === 1 || value === 0) value = Boolean(value);
        if (typeof value === 'string' &&
            (value.toLowerCase() === 'true' || value.toLowerCase() === 'false')
        ) value = Boolean(value);
        assert(typeof value === 'boolean', `value:${value}. the value must be a boolean. 值必须是一个布尔值`);
        this._value = value;
    }
    toString() {
        return this._value ? 'TRUE' : 'FALSE';
    }
}

class S7Number extends S7Value {
    constructor(value) {
        super();
        if (typeof value === 'string') value = Number(value);
        assert(Number.isFinite(value), `value:${value}. the value must be a number. 值必须是一个有限数字`);
        this._value = value;
    }
}

export class INT extends S7Number {
    constructor(value) {
        super(value);
        this._value = parseInt(this._value);
    }
    get HEX() {
        return this._value.toString(16);
    }
}

export class REAL extends S7Number {
    toString(para) {
        if (Number.isInteger(this._value)) return this._value.toFixed(1);
        return this._value.toString(para);
    }
}

export class STRING extends S7Value {
    constructor(value) {
        super();
        if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
        if (typeof value === 'boolean') value = String(value);
        assert(typeof value === 'string', `value:${value}. the value must be a string. 值必须是一个字符串`);
        this._value = value;
    }
    toString() {
        return this._value;
    }
}

export function nullable_typed_value(type, value) {
    if (value === undefined || value === null) return undefined;
    return new type(value);
}

export function ensure_typed_value(type, value) {
    return new type(value);
}

export function nullable_PINT(value) {
    if (value === undefined || value === null) return undefined;
    return ensure_PINT(value);
}

export function ensure_PINT(value) {
    const ret = new INT(value);
    if (ret.value < 0) throw new SyntaxError(`
value ${value} wrong, must be a positive integer.
数值 ${value} 错误，必须是正整数!`);
    return ret;
}

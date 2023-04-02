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
    const HEX = num instanceof Integer ? num.HEX : num?.toString(16);
    return pad_left(HEX, length, '0').toUpperCase();
}

class S7Value {
    _value;
    get value() {
        return this._value;
    }
    constructor(value) {
        this._value = value?.value ? value.value : value; // unbox ref object
    }
    toString(...paras) {
        return this._value.toString(...paras);
    }
}

export class BOOL extends S7Value {
    static check(value){
        assert(typeof value === 'boolean', `the value "${value}" must be a boolean. 值必须是一个布尔值`);
    }
    constructor(value) {
        super(value);
        value = this._value;
        if (value === 1 || value === 0) value = Boolean(value);
        if (typeof value === 'string' &&
            (value.toLowerCase() === 'true' || value.toLowerCase() === 'false')
        ) value = Boolean(value);
        BOOL.check(value);
        this._value = value;
    }
    toString() {
        return this._value ? 'TRUE' : 'FALSE';
    }
}

class S7Number extends S7Value {
    static check(value) {
        assert(Number.isFinite(value), `the value "${value}" must be a number. 值必须是一个有限数字`);
    }
    constructor(value) {
        if (typeof value === 'string') value = Number(value);
        super(value);
        S7Number.check(this._value);
    }
}

class Integer extends S7Number {
    constructor(value) {
        value = parseInt(value);
        super(value);
    }
    TC(radix) {
        const pow = Math.pow(2, radix);
        let result = this._value;
        if (this._value < 0) {
            result = ~Math.abs(result) + 1;
        }
        return result & (pow - 1);
    }
    get HEX() {
        return this._value.toString(16).toUpperCase();
    }
    get byteHEX() {
        return 'B#16#' + this.TC(8).toString(16).toUpperCase();
    }
    get wordHEX() {
        return 'W#16#' + this.TC(16).toString(16).toUpperCase();
    }
    get dwordHEX() {
        return 'DW#16#' + this.TC(32).toString(16).toUpperCase();
    }
}

export class INT extends Integer {
    static check(value) {
        assert(-32769 < value && value < 32768, `the value "${value}" range must be within 16 binary numbers. 值范围必须在16位二进制数以内`);
    }
    constructor(value) {
        super(value);
        INT.check(this._value);
    }
}

export class PINT extends Integer {
    static check(value) {
        assert(-1 < value && value < 65536, `the value "${value}" range must be within 16 binary numbers. 值范围必须在16位二进制数以内`);
    }
    constructor(value) {
        super(value);
        PINT.check(this._value);
    }
    toString() {
        return this._value.toString();
    }
}

export class DINT extends Integer {
    static check(value) {
        assert(-2147483649 < value && value < 2147483648, `the value "${value}" range must be within 32 binary numbers. 值范围必须在32位二进制数以内`);
    }
    constructor(value) {
        super(value);
        DINT.check(this._value);
    }
    toString() {
        return 'L#' + this._value.toString();
    }
}

export class PDINT extends Integer {
    static check(value) {
        assert(-1 < value && value < 4294967296, `the value "${value}" range must be within 32 binary numbers. 值范围必须在32位二进制数以内`);
    }
    constructor(value) {
        super(value);
        PDINT.check(this._value);
    }
    toString() {
        return 'L#' + this._value.toString();
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
        super(value);
        value = this._value;
        if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
        if (typeof value === 'boolean') value = String(value);
        assert(typeof value === 'string', `the value "${value}" must be a string. 值必须是一个字符串`);
        this._value = value;
    }
    toString() {
        return this._value;
    }
}

export function nullable_value(type, value) {
    if (value === undefined || value === null) return undefined;
    return new type(value);
}

export function ensure_value(type, value) {
    return new type(value);
}

import assert from 'node:assert/strict';
import { elog } from './util.js';

//#region parse
/**
 * Enum for ms per time unit.
 * @readonly
 * @enum {number}
 */
const ms_per = {
    day: 86400000,
    hour: 3600000,
    minute: 60000,
    second: 1000,
}
const time_base2ms = [10, 100, 1000, 10000];

/**
 * Convert milliseconds to a format like 24d_56h_33m_250ms
 * @param {number} ms
 * @returns {string}
 */
function getTimeDurationStr(value) {
    if (value === 0) return '0';
    const strList = [];
    let remainder;
    let quotient = value;
    if (quotient > 0) {
        remainder = quotient % ms_per.second;
        if (remainder > 0) strList.unshift(`${remainder}MS`);
        quotient = quotient - remainder;
    }
    if (quotient > 0) {
        remainder = quotient % ms_per.minute;
        if (remainder > 0) strList.unshift(`${remainder / ms_per.second}S`);
        quotient = quotient - remainder;
    }
    if (quotient > 0) {
        remainder = quotient % ms_per.hour;
        if (remainder > 0) strList.unshift(`${remainder / ms_per.minute}M`);
        quotient = quotient - remainder;
    }
    if (quotient > 0) {
        remainder = quotient % ms_per.day;
        if (remainder > 0) strList.unshift(`${remainder / ms_per.hour}H`);
        quotient = quotient - remainder;
    }
    if (quotient > 0) {
        strList.unshift(`${quotient / ms_per.day}D`);
    }
    return strList.join("_");
}

/**
 * Convert other unit time strings to milliseconds
 * @param {string} str
 */
function parse_unit(str) {
    if (str.endsWith('ms')) {
        return Number.parseInt(str.slice(0, -2));
    }
    const value = Number.parseInt(str.slice(0, -1));
    if (str.endsWith('s')) {
        return value * ms_per.second;
    }
    if (str.endsWith('m')) {
        return value * ms_per.minute;
    }
    if (str.endsWith('h')) {
        return value * ms_per.hour;
    }
    if (str.endsWith('d')) {
        return value * ms_per.day;
    }
    return 0;
}

/**
 * Convert string to milliseconds
 * @param {string} str
 */
function parse2ms(str) {
    const timeStrList = str.replace(/([dhms])(\d)/ig, '$1_$2').split("_");
    const msList = timeStrList.map(parse_unit);
    return msList.reduce((ms, value) => ms + value, 0);
}

/**
 * Accepts a TIME literal or a number of milliseconds
 * range: TIME#-24d_20h_31m_23s_648ms ~ TIME#24d_20h_31m_23s_647ms
 * @param {string|number} value
 */
function get_ms_form(value) {
    const INPUT_ERROR = new SyntaxError("input error, parameter must be a TIME or a Number.");
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value !== "string") elog(INPUT_ERROR);
    let valStr = value.trim().toLowerCase();
    if (!/^(t|time)#(\d+d_?)?(\d+h_?)?(\d+m_?)?(\d+s_?)?(\d+ms)?$/.test(valStr)) elog(INPUT_ERROR);
    valStr = valStr.replace(/(time|t)#/, "").replace(/([dhms])(\d)/ig, '$1_$2');
    let sign = 1;
    if (valStr[0] === '-') {
        valStr = valStr.substring(1);
        sign = -1;
    }
    return sign * parse2ms(valStr);
}
//#endregion parse

class S7Value {
    _value;
    get value() {
        return this._value;
    }
    get type() {
        return this.name;
    }
    constructor(value) {
        this._value = value?.value ? value.value : value; // unbox ref object
    }
    toString(...paras) {
        return this._value.toString(...paras);
    }
}

export class BOOL extends S7Value {
    static check(value) {
        assert(typeof value === 'boolean', `the value "${value}" must be a boolean. 值必须是一个布尔值`);
    }
    constructor(value) {
        let bool_value = value;
        if (value === 0) bool_value = false;
        if (value === 1) bool_value = true;
        if (value?.toLowerCase?.() === 'false') bool_value = false;
        if (value?.toLowerCase?.() === 'true') bool_value = true;
        BOOL.check(bool_value);
        super(bool_value);
    }
    [Symbol.toPrimitive](hint) {
        if (hint === 'boolean') {
            return this._value;
        }
        return this.toString();
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
        super(typeof value === 'string' ? Number(value) : value);
        S7Number.check(this._value);
    }
    [Symbol.toPrimitive](hint) {
        if (hint === 'number') {
            return this._value;
        }
        return this.toString();
    }
    [Symbol.compare](other) {
        if (this.value < other.value) return -1;
        if (this.value > other.value) return 1;
        return 0;
    }
}

export class Integer extends S7Number {
    constructor(value) {
        super(Number.parseInt(value));
    }
    /**
     * get Two's Complement
     */
    TC(exponent) {
        let result = this._value;
        if (this._value < 0) {
            result = ~Math.abs(result) + 1;
        }
        const mask = 2 ** exponent - 1;
        return result & mask;
    }
    get HEX() {
        return this._value.toString(16).toUpperCase();
    }
    get byteHEX() {
        return `B#16#${this.TC(8).toString(16).toUpperCase()}`;
    }
    get wordHEX() {
        return `W#16#${this.TC(16).toString(16).toUpperCase()}`;
    }
    get dwordHEX() {
        return `DW#16#${this.TC(32).toString(16).toUpperCase()}`;
    }
    get DINT() {
        return `L#${this._value.toString()}`;
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
        return this.DINT;
    }
}
export class TIME extends DINT {
    /**
     * original value
     * @return {number}
     */
    get rawValue() {
        return this._value;
    }

    /**
     * Accepts a TIME literal or a number of milliseconds
     * range: TIME#-24d_20h_31m_23s_648ms ~ TIME#24d_20h_31m_23s_647ms
     * @param {string|number} value
     */
    set S7Value(value) {
        this._value = get_ms_form(value);
    }

    /**
     * Accepts a TIME literal or a number of milliseconds
     * range: TIME#-24d_20h_31m_23s_648ms ~ TIME#24d_20h_31m_23s_647ms
     * @param {string|number} value
     */
    set value(value) {
        this.S7Value = value;
    }

    constructor(value) {
        // unbox ref object
        super(get_ms_form(value?.value ? value.value : value));
    }

    /**
     * S7 TIME literal string
     * @return {string}
     */
    get S7Value() {
        let value = this._value;
        let sign = "";
        if (value < 0) {
            value = -value;
            sign = "-";
        }
        return `TIME#${sign}${getTimeDurationStr(value)}`;
    }

    toString() {
        return this.S7Value;
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
        return `L#${this._value.toString()}`;
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
        let _value = this._value;
        if (typeof _value === 'number' && Number.isFinite(_value)) _value = String(_value);
        if (typeof _value === 'boolean') _value = String(_value);
        assert(typeof _value === 'string', `the value "${_value}" must be a string. 值必须是一个字符串`);
        this._value = _value;
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

function isInt(num) {
    return typeof num === 'number'
        && !Number.isNaN(num)
        && Number.isInteger(num)
        && Number.isFinite(num);
}

function isPInt(num) {
    return isInt(num) && num >= 0;
}

export function dec2foct(num) {
    if (!isPInt(num)) elog(new TypeError(`${num} 不是非负整数!`));
    const bit = num % 8;
    const byte = (num - bit) / 8;
    return [byte, bit];
}

export function foct2dec(byte, bit = 0) {
    if (byte != null && !isPInt(byte)) elog(new TypeError(`byte ${byte} 不是非负整数!`));
    if (!isPInt(bit)) elog(new TypeError(`bit ${bit} 不是非负整数!`));
    return (byte == null || bit == null) ? null : byte * 8 + bit;
}

export function foct2S7addr(byte, bit) {
    const error = new TypeError('num is wrong!');
    if (!isPInt(byte)) elog(error);
    if (!isPInt(bit) || bit > 7) elog(error);
    return byte + bit / 10;
}

export function s7addr2foct(s7addr) {
    const error = new TypeError(`s7 address ${s7addr} is wrong!`);
    const s7addr_int = s7addr * 10;
    if (!isPInt(s7addr_int)) elog(error);
    const bit = s7addr_int % 10;
    const byte = (s7addr_int - bit) / 10;
    if (bit > 7) elog(error);
    return [byte, bit];
}

function size2dec(size) {
    const error = new TypeError(`size ${size} is wrong!`);
    const [byte, bit] = s7addr2foct(size);
    if (byte > 0 && bit === 1) elog(error);
    if (bit !== 0 && bit !== 1) elog(error);
    if (byte > 1 && byte % 2 !== 0) elog(error);
    return foct2dec(byte, bit);
}

export function get_boundary(num, num_size) {
    if (!isPInt(num)) {
        elog(new TypeError(`${num} Not a non-negative integer!`));
    }
    if (num_size < 0 || (num_size !== 1 && num_size % 8 !== 0)) {
        elog(new TypeError(`${num_size} Not a valid variable storage length!`));
    }
    if (num_size === 1) return num;
    let quotient = num;
    let remainder = num % 8;
    if (remainder > 0) quotient += 8 - remainder;
    if (num_size === 8) return quotient;
    remainder = quotient % 16;
    if (remainder > 0) quotient += 16 - remainder;
    return quotient;
}

export class HLError extends Error {
    num;
    size;
    constructor(message, options) {
        super(message, options);
        this.num = options?.num;
        this.size = options?.size;
    }
}

export class HashList {
    curr_item;
    #last_size = 1;
    #curr_index;

    constructor(next = 0) {
        this.#curr_index = next;
    }
    next() {
        this.#curr_index += this.#last_size;
    }
    check(num) {
        if (num == null) {
            return this.get_new();
        }
        if (!isPInt(num)) {
            elog(new TypeError(`${num} Not a non-negative integer!`));
        }
        return num;
    }
    get_new() {
        const num = this.#curr_index;
        this.next();
        return num;
    }
    push(num, size) {
        // Implement checking num by subclass
        // only positioning here
        if (size != null && !isPInt(size)) elog(new TypeError(`${size} Not a non-negative integer!`));
        this.#curr_index = num + size;
        this.#last_size = size;
    }
}

export class IntHashList extends HashList {
    #list = [];

    check(num) {
        let n = num?.value ? num.value : num; // unbox ref object
        if (n == null || n === 0) {
            do {
                n = super.check(null);
            } while (this.#list.includes(n));
        } else {
            n = super.check(n);
            if (this.#list.includes(n)) {
                elog(new HLError(`存在重复的地址 ${n}!`));
            }
        }
        return n;
    }

    push(num) {
        try {
            const n = this.check(num);
            super.push(n, 1);
            this.#list.push(n);
            return n;
        } catch (e) {
            if (e instanceof TypeError) {
                elog(new TypeError(e.message, { cause: num }));
            } else if (e instanceof HLError) {
                elog(new HLError(e.message, { num }));
            }
        }
    }
}

export class S7HashList extends HashList {
    #list = {};
    constructor(next = 0) {
        super(foct2dec(...s7addr2foct(next)));
    }

    check(num, nsize) {
        let n = num;
        if (n == null) {
            do {
                n = super.check(null);
                n = get_boundary(n, nsize);
            } while (this.#list[`${n}:${nsize}`]);
        } else {
            if (!isPInt(n) || n !== get_boundary(n, nsize)) {
                elog(new HLError(`${dec2foct(n).join('.')}不是正确的地址!`));
            }
            n = super.check(n);// check if it's a PInt
            if (this.#list[`${n}:${nsize}`]) { // cannot be repeated
                elog(new HLError(`存在重复的 ${dec2foct(n).join('.')} (size:${nsize})!`));
            }
        }
        return n;
    }

    push(s7addr, size = 1) {
        let n;
        try {
            const nsize = size2dec(size);
            if (s7addr != null) n = foct2dec(...s7addr2foct(s7addr));
            if (isPInt(n)) n = get_boundary(n, nsize);
            n = this.check(n, nsize);
            this.#list[`${n}:${nsize}`] = true;
            super.push(n, nsize);
        } catch (e) {
            if (e instanceof HLError) {
                elog(new HLError(e.message, { num: s7addr, size }));
            }
            elog(new TypeError(e.message, { cause: s7addr }));
        }
        return s7addr ?? foct2S7addr(...dec2foct(n));
    }
}

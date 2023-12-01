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
 * 将毫秒数转换成类似 24d_56h_33m_250ms 格式
 * @param {number} ms
 * @returns {string}
 */
function getTimeDurationStr(value) {
    if (value == 0) return '0';
    let strList = [];
    let remainder;
    if (value > 0) {
        remainder = value % ms_per.second;
        if (remainder > 0) strList.unshift(remainder + "MS");
        value = value - remainder;
    }
    if (value > 0) {
        remainder = value % ms_per.minute;
        if (remainder > 0) strList.unshift(remainder / ms_per.second + "S");
        value = value - remainder;
    }
    if (value > 0) {
        remainder = value % ms_per.hour;
        if (remainder > 0) strList.unshift(remainder / ms_per.minute + "M");
        value = value - remainder;
    }
    if (value > 0) {
        remainder = value % ms_per.day;
        if (remainder > 0) strList.unshift(remainder / ms_per.hour + "H");
        value = value - remainder;
    }
    if (value > 0) {
        strList.unshift(value / ms_per.day + "D");
    }
    return strList.join("_");
}

/**
 * 将其它单位时间字符串转换为毫秒数
 * @param {string} str
 */
function parse_unit(str) {
    if (str.endsWith('ms')) {
        return parseInt(str.slice(0, -2));
    }
    let value = parseInt(str.slice(0, -1));
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
 * 将字符串转换为毫秒数
 * @param {string} str
 */
function parse2ms(str) {
    const timeStrList = str.replace(/([dhms])(\d)/ig, '$1_$2').split("_");
    const msList = timeStrList.map(parse_unit);
    return msList.reduce((ms, value) => ms + value, 0);
}

/**
 * 接受 TIME 字面量或毫秒数
 * 范围： TIME#-24d_20h_31m_23s_648ms ~ TIME#24d_20h_31m_23s_647ms
 * @param {string|number} value
 */
function get_ms_form(value) {
    const INPUT_ERROR = new Error("input error, parameter must be a TIME or a Number.");
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value !== "string") throw INPUT_ERROR;
    let valStr = value.trim().toLowerCase();
    if (!/^(t|time)#(\d+d_?)?(\d+h_?)?(\d+m_?)?(\d+s_?)?(\d+ms)?$/.test(valStr)) throw INPUT_ERROR;
    valStr = valStr.replace(/(time|t)#/, "").replace(/([dhms])(\d)/ig, '$1_$2');
    let sign = 1;
    if (valStr[0] == '-') {
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
        super(value);
        value = this._value;
        if (value === 1 || value === 0) value = Boolean(value);
        if (typeof value === 'string' &&
            (value.toLowerCase() === 'true' || value.toLowerCase() === 'false')
        ) value = Boolean(value);
        BOOL.check(value);
        this._value = value;
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
        if (typeof value === 'string') value = Number(value);
        super(value);
        S7Number.check(this._value);
    }
    [Symbol.toPrimitive](hint) {
        if (hint === 'number') {
            return this._value;
        }
        return this.toString();
    }
    [Symbol.compare](other) {
        if (this.value < other.value) {
            return -1;
        } else if (this.value > other.value) {
            return 1;
        } else {
            return 0;
        }
    }
}

class Integer extends S7Number {
    constructor(value) {
        value = parseInt(value);
        super(value);
    }
    /**
     * get Two's Complement 获得补码
     */
    TC(exponent) {
        let result = this._value;
        if (this._value < 0) {
            result = ~Math.abs(result) + 1;
        }
        const mask = Math.pow(2, exponent) - 1;
        return result & mask;
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
    get DINT(){
        return 'L#' + this._value.toString();
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
     * 原始值
     * @return {number}
     */
    get rawValue() {
        return this._value;
    }

    /**
     * 接受 TIME 字面量或毫秒数
     * 范围： TIME#-24d_20h_31m_23s_648ms ~ TIME#24d_20h_31m_23s_647ms
     * @param {string|number} value
     */
    set S7Value(value) {
        this._value = get_ms_form(value);
    }

    /**
     * 接受 TIME 字面量或毫秒数
     * 范围： TIME#-24d_20h_31m_23s_648ms ~ TIME#24d_20h_31m_23s_647ms
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
     * S7 TIME 字面量形式的字符串
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

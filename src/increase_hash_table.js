export class IncHLError extends Error {
    num;
    size;
    constructor(message, options) {
        super(message, options);
        this.num = options?.num;
        this.size = options?.size;
    }
}

class IncreaseHL { // abstract class
    curr_item;
    #curr_size = 1;
    #curr_index;
    constructor(next = 0, size = 1) {
        this.#curr_index = next;
        this.#curr_size = size;
    }
    next() {
        this.#curr_index += this.#curr_size;
    }
    check(num) {
        if (num == null) {
            num = this.get_new();
        } else {
            // 不能非正数字
            if (typeof num !== 'number' || isNaN(num) || num < 0) throw new TypeError(`${num} 不是正整数!`);
        }
        return num;
    }
    get_new() {
        const num = this.#curr_index;
        this.next();
        return num;
    }
    push(num, size = 1) {
        this.#curr_index = parseInt(num) + size;
        this.#curr_size = size;
    }
}
export class IntIncHL extends IncreaseHL {
    #list = [];
    check(num) {
        if (num == null || num === 0) {
            do {
                num = super.check(null);
            } while (this.#list.includes(num));
        } else {
            num = super.check(num);
            // 不能重复
            if (this.#list.includes(num)) throw new IncHLError(`存在重复的地址 ${num}!`);
        }
        return num;
    }
    push(num) {
        try {
            num = this.check(num);
            super.push(num, 1);
            this.#list.push(num);
        } catch (e) {
            if (e instanceof TypeError) {
                throw new TypeError(e.message, { cause: num });
            } else if (e instanceof IncHLError) {
                throw new IncHLError(e.message, { num });
            }
        }
        return num;
    }
}

function dec2foct(num) {
    const bit = num % 8;
    const byte = (num - bit) / 8
    return [byte, bit]
}

function foct2dec(byte, bit) {
    return (byte == null || bit == null) ? null : byte * 8 + bit;
}

export class S7IncHL extends IncreaseHL {
    #list = {};
    constructor(next = [0, 0]) {
        super(foct2dec(...next));
    }

    convert_size(size) {
        const byte = Math.floor(size);
        const bit = (size - byte) * 10;
        if (byte > 0 && bit > 0) throw new IncHLError(`size ${size} is wrong!`);
        return foct2dec(byte, bit);
    }

    check(num, size) {
        if (num == null) {
            do {
                num = super.check(null);
            } while (this.#list[num + ':' + size]);
        } else {
            num = super.check(num);
            // 不能重复
            if (this.#list[num + ':' + size]) throw new IncHLError(`存在重复的 ${dec2foct(num).join('.')} (size:${size})!`);
        }
        return num;
    }

    push(item, size = 1.0) {
        try {
            let num = foct2dec(...(item ?? []));
            num = this.check(num, size);
            this.#list[num + ':' + size] = true;
            let remainder = num % 8;
            if (size == 1.0 && remainder > 0) num += 8 - remainder;
            remainder = num % 16;
            if (size >= 2.0 && remainder > 0) num += 16 - remainder;
            super.push(num, this.convert_size(size));
        } catch (e) {
            if (e instanceof TypeError) {
                throw new TypeError(e.message, { cause: num });
            } else if (e instanceof IncHLError) {
                throw new IncHLError(e.message, { num, size });
            }
        }
        return dec2foct(num);
    }
}
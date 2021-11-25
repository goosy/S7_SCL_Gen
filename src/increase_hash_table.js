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
            if (typeof num !== 'number' || isNaN(num) || num <= 0) throw new Error(`${num} 不是正整数!`);
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
    push(num) {
        num = this.check(num);
        super.push(num, 1);
        this.#list.push(num);
        return num
    }
    check(num) {
        if (num == null) {
            do {
                num = super.check(null);
            } while (this.#list.includes(num));
        } else {
            num = super.check(num);
            // 不能重复
            if (this.#list.includes(num)) throw new Error(`存在重复的 ${num}!`);
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
    return byte * 8 + bit;
}

export class S7IncHL extends IncreaseHL {
    #list = {};
    constructor(next = [0, 0]) {
        super(foct2dec(...next));
    }

    convert_size(size) {
        const byte = Math.floor(size);
        const bit = (size - byte) * 10;
        if (byte > 0 && bit > 0) throw new Error(`size ${size} is wrong!`);
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
            if (this.#list[num + ':' + size]) throw new Error(`存在重复的 ${dec2foct(num)}:${size}!`);
        }
        return num;
    }

    push(item, size = 1.0) {
        let num;
        num = item == null ? null : foct2dec(item);
        num = this.check(num, size);
        super.push(num, convert_size(size));
        this.#list[num + ':' + size] = true;
        return dec2foct(num);
    }
}

export class IncreaseHashTable {
    list = [];
    next;

    constructor(no) {
        this.next = no;
    }

    push(num) {
        if (num == null) return this.push_new();
        // 不能非正数字
        if (typeof num !== 'number' || isNaN(num) || num <= 0) throw new Error(`${num} 不是正整数!`);
        // 不能重复
        if (this.list.includes(num)) throw new Error(`存在重复的 ${num}!`);
        this.next = parseInt(num) + 1;
        this.list.push(num);
        return num
    }

    push_new() {
        // 自动取下一个有效的数字
        let num = this.next;
        while (this.list.includes(num)) num++;
        this.list.push(num);
        this.next = num + 1;
        return num;
    }
}
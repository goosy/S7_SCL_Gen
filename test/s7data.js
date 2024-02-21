import {
    IntHashList, S7HashList,
    HLError, get_boundary, foct2dec, foct2S7addr, s7addr2foct, dec2foct,
    BOOL, TIME
} from '../src/s7data.js';
import {
    AssertionError,
    ok, equal, deepEqual, strictEqual,
    throws
} from "node:assert/strict";

describe('S7Data 测试', () => {
    it('辅助功能正常', () => {
        deepEqual(s7addr2foct(200.1), [200, 1]);
        strictEqual(foct2dec(200, 1),1601);
        deepEqual(dec2foct(1601), [200, 1]);
        strictEqual(foct2S7addr(200, 1), 200.1);
    });
    it('边界定位', () => {
        strictEqual(get_boundary(9, 1), 9);
        strictEqual(get_boundary(23, 8), 24);
        strictEqual(get_boundary(7, 32), 16);
        throws(() => {
            get_boundary(-33, 32);
        }, TypeError);
    });
    it('正确分配IntHashList', () => {
        const hl = new IntHashList(8);
        const n1 = hl.push();
        const n2 = hl.push();
        const n3 = hl.push(12);
        strictEqual(n1, 8);
        strictEqual(n2, 9);
        strictEqual(n3, 12);
        throws(() => {
            hl.push(12);
        }, HLError);
    });
    it('正确分配S7HashList', () => {
        const a = new S7HashList(200.0);
        const n1 = a.push(null, 1.0);
        const n2 = a.push(null, 2.0);
        const n3 = a.push(null, 0.1);
        const n4 = a.push(null, 0.1);
        const n5 = a.push(null, 4.0);
        const n6 = a.push(220.0, 4.0);
        equal(n1, 200.0);
        equal(n2, 202.0);
        equal(n3, 204.0);
        equal(n4, 204.1);
        equal(n5, 206.0);
        equal(n6, 220.0);
        throws(() => {
            a.push(2.8, 1.0);
        }, TypeError);
        throws(() => {
            a.push(2.0, 1.1);
        }, TypeError);
        throws(() => {
            a.check(38, 16); // 4.6 2.0
        }, HLError);
        throws(() => {
            a.push(200.0, 1.0);
        }, HLError);
    });
});

describe('S7数值测试', () => {
    it('BOOL test0', () => {
        strictEqual(new BOOL(0).value, false);
        strictEqual(new BOOL(1).value, true);
        strictEqual(new BOOL('False').value, false);
        strictEqual(new BOOL('True').value, true);
        strictEqual(new BOOL(false).value, false);
        strictEqual(new BOOL(true).value, true);
        throws(() => new BOOL(10), AssertionError);
        throws(() => new BOOL(''), AssertionError);
        throws(() => new BOOL([]), AssertionError);
    })
    it('TIME test1', () => {
        const v = new TIME('T#5S');
        strictEqual(v.rawValue, 5000);
    });
});
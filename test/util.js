import {
    AssertionError,
    ok, equal, deepEqual, strictEqual,
    throws
} from "node:assert/strict";

import {
    pad_left, pad_right
} from '../src/util.js';

describe('pad_left test', () => {
    it('BOOL test0', () => {
        strictEqual(pad_left('abcdef', 20), '              abcdef');
        strictEqual(pad_left('abcdef', 4), 'cdef');
        strictEqual(pad_left('abcdef', 15, '*'), '*********abcdef');
    })
});
describe('pad_right test', () => {
    it('BOOL test0', () => {
        strictEqual(pad_right('abcdef', 20), 'abcdef              ');
        strictEqual(pad_right('abcdef', 4), 'abcd');
        strictEqual(pad_right('abcdef', 15, '*'), 'abcdef*********');
    })
});

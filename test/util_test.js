import {
    AssertionError,
    ok, equal, deepEqual, strictEqual,
    throws
} from "node:assert/strict";

import {
    pad_left, pad_right,
    context, get_template,
} from '../src/util.js';

context.custom_converters.AI = { template: 'test/test.template' };

describe('util test', () => {
    it('pad_left test', () => {
        strictEqual(pad_left('abcdef', 20), '              abcdef');
        strictEqual(pad_left('abcdef', 4), 'cdef');
        strictEqual(pad_left('abcdef', 15, '*'), '*********abcdef');
    })
    it('pad_right test', () => {
        strictEqual(pad_right('abcdef', 20), 'abcdef              ');
        strictEqual(pad_right('abcdef', 4), 'abcd');
        strictEqual(pad_right('abcdef', 15, '*'), 'abcdef*********');
    })
    it('get_template test', async () => {
        strictEqual(await get_template('AI'), '测试: {{LOOP_NAME}}\n文件: {{gcl.file}}');
    })
});

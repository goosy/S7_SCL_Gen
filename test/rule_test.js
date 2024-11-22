import { suite, test } from 'node:test';
import { ok, strictEqual } from "node:assert/strict";
import { match, match_all } from '../src/rules/index.js';

suite('util test', () => {
    test('match test', () => {
        // null
        ok(!match(null, '*'));
        ok(match(null, '%u'));
        ok(match({}, '*'));
        ok(match([], '*'));
        ok(!match({}, []));
        ok(!match([], []));
        ok(!match({}));
        ok(!match([], null));
        // boolean
        ok(match(true, '%b'));
        ok(match(false, '%b'));
        ok(!match(0, '%b'));
        ok(!match({}, '%b'));
        ok(!match([], '%b'));
        ok(!match('', '%b'));
        // string
        ok(match('', '%s'));
        ok(!match({}, '%s'));
        ok(!match([], '%s'));
        ok(!match(0, '%s'));
        ok(!match(true, '%s'));
        ok(match('abcdef', 'abcdef'));
        ok(match('abcdef', ['4', 'ab*']));
        ok(!match(['abcdef', 'foo'], 'b*'));
        ok(match(['abcdef', 'foo'], ['f*', 'b*']));
        // number
        ok(match(0, '%n'));
        ok(match(123, '%n'));
        ok(match(123.456, '%n'));
        ok(match(123.456, 123.456));
        ok(!match(123.456, 123));
        ok(!match(true, '%n'));
        ok(!match('', '%n'));
        ok(!match({}, '%n'));
        ok(!match([], '%n'));
        // array
        ok(match([], '%a'));
        ok(!match(0, '%a'));
        ok(!match('', '%a')); 
        ok(!match(true, '%a'));
        ok(!match({}, '%a'));
        // object
        ok(match({}, '%o'));
        ok(match(
            {str: 'abcdef', foo: 'foo'},
            { str: '*', foo: 'foo' }
        ));
        ok(!match('', '%o'));
        ok(!match([], '%o'));
        ok(!match(0, '%o'));
        ok(!match(true, '%o'));
    });
    test('match_all test', () => {
        strictEqual(
            match_all(['fee', 'foo', 'doo', 'fum', 'zoo'], 'f*').join(', '),
            'fee, foo, fum'
        );
        strictEqual(
            match_all(['fee', 'foo', 'doo', 'fum', 'zoo'], ['f*', 'd*']).join(', '),
            'fee, foo, doo, fum'
        );
    });
});

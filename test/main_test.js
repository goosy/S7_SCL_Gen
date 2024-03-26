/* eslint-disable no-undef */
import { ok, equal } from "node:assert/strict";
import { chdir, cwd } from 'node:process';
import { context, read_file, forEachAsync } from '../src/util.js';
import { match_list } from '../src/rules.js';
import { convert } from '../src/index.js';


chdir('./test');
context.work_path = cwd().replace(/\\/g, '/');
context.silent = true;
// context.noconvert = true;
const { copy_list: copy_list1, convert_list: convert_list1 } = await convert([
    {
        pattern: { enable: true },
        actions: { enable: false }, // 不实际输出
    }
]);
const template = await read_file('test.template');
// 支持多实例
const { copy_list: _, convert_list: convert_list2 } = await convert([
    {
        pattern: { type: 'copy' },
        actions: { enable: false },
    }, {
        pattern: { distance: ['!**.csv', '!**.asc'], template: '*' },
        actions: { template },
    }
]);

describe('生成SCL测试', () => {
    describe('配置正确转换', () => {
        it('复制指定文件', async () => {
            const src = '**/AI_Proc(step7).scl';
            match_list(copy_list1, {
                CPU: 'dist',
                feature: 'AI',
                src,
            }).forEach(item => {
                equal(item.dst, `dist/AI_Proc.scl`);
            });
            match_list(copy_list1, {
                CPU: 'dist',
                dst: `**/test.yaml`,
            }).forEach(item => {
                equal(item.feature, 'AI');
            });
            const source = `${context.work_path}/test.yaml`;
            await forEachAsync(
                match_list(copy_list1, {
                    CPU: 'dist',
                    src: '**/test.yaml',
                }),
                async item => equal(item.content, await read_file(source))
            );
        });
        it('检查指定属性', () => {
            match_list(copy_list1, {
                feature: 'CPU',
            }).forEach(item => {
                equal(item.CPU, 'dist');
            });
            ok(match_list(copy_list1, {
                feature: 'AI',
            }).length);
            ok(match_list(copy_list1, {
                platform: 'step7',
            }).length);
        });
        it('生成指定文件', () => {
            const AI_out = match_list(convert_list2, {
                feature: 'AI',
                dst: `**/AI_Loop.scl`,
            });
            ok(AI_out.length);
            AI_out.forEach(item => equal(
                item.content,
                `测试: AI_Loop\n文件: D:/codes/AS/S7_SCL_Gen/test/test.yaml`,
            ));
            ok(match_list(convert_list2, {
                CPU: 'dist',
                dst: `**/alarms.csv`,
            }).length);
        });
    });
});

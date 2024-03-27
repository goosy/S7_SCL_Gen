/* eslint-disable no-undef */
import { ok, equal } from "node:assert/strict";
import { chdir, cwd } from 'node:process';
import { context, read_file, forEachAsync } from '../src/util.js';
import { match_list } from '../src/rules.js';
import { convert } from '../src/index.js';

chdir('./test');
context.work_path = cwd().replace(/\\/g, '/');
context.silent = true;
context.noconvert = true;

// 实例1
const { copy_list, convert_list: _1 } = await convert();

// 实例2 应用 rulers
const template = await read_file('test.template');
const { copy_list: _2, convert_list } = await convert([
    {
        pattern: { type: 'copy' },
        modifications: { enable: false },
    }, {
        pattern: { distance: ['!**.csv', '!**.asc'], template: '*' },
        modifications: { template },
    }
]);

describe('生成SCL测试', () => {
    describe('配置正确转换', () => {
        it('复制指定文件', async () => {
            const src = '**/AI_Proc(step7).scl';
            match_list(copy_list, {
                CPU: 'dist',
                feature: 'AI',
                src,
            }).forEach(item => {
                equal(item.dst, `dist/AI_Proc.scl`);
            });
            match_list(copy_list, {
                CPU: 'dist',
                dst: `**/test.yaml`,
            }).forEach(item => {
                equal(item.feature, 'AI');
            });
            const source = `${context.work_path}/test.yaml`;
            await forEachAsync(
                match_list(copy_list, {
                    CPU: 'dist',
                    src: '**/test.yaml',
                }),
                async item => equal(item.content, await read_file(source))
            );
        });
        it('检查指定属性', () => {
            match_list(copy_list, { feature: 'CPU', }).forEach(item => {
                equal(item.CPU, 'dist');
            });
            ok(match_list(copy_list, { feature: 'AI', }).length);
            ok(match_list(copy_list, { platform: 'step7', }).length);
        });
        it('生成指定文件', () => {
            const AI_out = match_list(convert_list, {
                feature: 'AI',
                dst: `**/AI_Loop.scl`,
            });
            ok(AI_out.length);
            AI_out.forEach(item => equal(
                item.content,
                `测试: AI_Loop\n文件: D:/codes/AS/S7_SCL_Gen/test/test.yaml`,
            ));
            ok(match_list(
                convert_list,
                { CPU: 'dist', dst: `**/alarms.csv`, }
            ).length);
        });
    });
});

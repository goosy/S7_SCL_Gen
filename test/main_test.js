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
const template = await read_file('template.md');
const { copy_list: _2, convert_list } = await convert([
    {
        pattern: { type: 'copy' },
        modifications: { enable: false },
    }, {
        pattern: { distance: ['!**.csv', '!**.asc'], template: '*' },
        modifications: { template, output_dir: 'target' },
    }
]);

const test_content = `# 联校调试记录

工程名称： undefined
测试内容： 通道联调

[undefined]
| 回路 | 仪表位号 | 测量范围 | 实测值 0% | 实测值 50% | 实测值 100% | 报警值 | 调试结果 |
| --- | --- | :---: | --- | --- | --- | --- | --- |
| | TIT101 |  0.0 - 100.0 | 0.000 | 50.000 | 100.000 |  | 合格 |

调试单位: __________________________ 专业工程师: ________ 质量检查员: ________ 施工班组长: ________
日期: ________ 年 ____ 月 ____ 日
`

describe('生成SCL测试', () => {
    describe('配置正确转换', () => {
        it('复制指定文件', async () => {
            const source = '**/AI_Proc(step7).scl';
            match_list(copy_list, {
                CPU: 'dist',
                feature: 'AI',
                source,
            }).forEach(item => {
                equal(item.distance, `dist/AI_Proc.scl`);
            });
            match_list(copy_list, {
                CPU: 'dist',
                distance: `**/test.yaml`,
            }).forEach(item => {
                equal(item.feature, 'AI');
            });
            const src_file = `${context.work_path}/test.yaml`;
            await forEachAsync(
                match_list(copy_list, {
                    CPU: 'dist',
                    source: '**/test.yaml',
                }),
                async item => equal(item.content, await read_file(src_file))
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
                distance: `**/AI_Loop.scl`,
            });
            ok(AI_out.length);
            equal(AI_out[0].output_dir, 'target');
            AI_out.forEach(item => equal(
                item.content,
                test_content,
            ));
            ok(match_list(
                convert_list,
                { CPU: 'dist', distance: `**/alarms.csv`, }
            ).length);
        });
    });
});

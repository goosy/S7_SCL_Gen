/* eslint-disable no-undef */
import { ok, equal } from "node:assert/strict";
import { chdir, cwd } from 'node:process';
import { isMatch } from 'matcher';
import { context, read_file } from '../src/util.js';
import { convert } from '../src/index.js';

async function asyncForEach(arr, callback) {
    for (const item of arr) {
        await callback(item);
    }
}

const match = (list, pattern) => list.filter(item => {
    for (const [key, value] of Object.entries(pattern)) {
        if (!isMatch(item[key], value)) return false;
    }
    return true;
});

chdir('./test');
context.work_path = cwd().replace(/\\/g, '/');
context.silent = true;
context.noconvert = true; // 不实际输出
const { copy_list: copy_list1, convert_list: convert_list1 } = await convert();
// 支持多实例
context.custom_converters.AI = { template: 'test/test.template' };
const { copy_list: copy_list2, convert_list: convert_list2 } = await convert();

describe('生成SCL测试', () => {
    describe('配置正确转换', () => {
        it('复制指定文件', async () => {
            const src = '**/AI_Proc(step7).scl';
            match(copy_list1, {
                cpu_name: 'dist',
                feature: 'AI',
                src,
            }).forEach(item => {
                equal(item.dst, `dist/AI_Proc.scl`);
            });
            match(copy_list1, {
                cpu_name: 'dist',
                dst: `**/test.yaml`,
            }).forEach(item => {
                equal(item.feature, 'AI');
            });
            const source = `${context.work_path}/test.yaml`;
            await asyncForEach(
                match(copy_list1, {
                    cpu_name: 'dist',
                    src: '**/test.yaml',
                }),
                async item => equal(item.content, await read_file(source))
            );
        });
        it('检查指定属性', () => {
            match(copy_list1, {
                feature: 'CPU',
            }).forEach(item => {
                equal(item.CPU, 'dist');
            });
            ok(match(copy_list1, {
                feature: 'AI',
            }).length);
            ok(match(copy_list1, {
                platform: 'step7',
            }).length);
        });
        it('生成指定文件', () => {
            const AI_out = match(convert_list2, {
                feature: 'AI',
                dst: `**/AI_Loop.scl`,
            });
            ok(AI_out.length);
            AI_out.forEach(item => equal(
                item.content,
                `测试: AI_Loop\n文件: D:/codes/AS/S7_SCL_Gen/test/test.yaml`,
            ));
            ok(match(convert_list2, {
                cpu_name: 'dist',
                dst: `**/alarms.csv`,
            }).length);
        });
    });
});

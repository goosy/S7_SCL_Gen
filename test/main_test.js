/* eslint-disable no-undef */
import { ok } from "node:assert/strict";
import { chdir, cwd } from 'node:process';
import { context, read_file } from '../src/util.js';
import { convert } from '../src/index.js';

chdir('./test');
context.work_path = cwd().replace(/\\/g, '/');
context.silent = true;
context.noconvert = true; // 不实际输出
context.custom_converters.AI = { template: 'test/test.template' };
const { copy_list, convert_list } = await convert();
const find_in_list = (list, name, value) => list.find(item => {
    return item[name] == value
});

context.custom_converters.AI = { template: 'test/test.template' };
// 支持多实例
// const { copy_list: new_copy_list, convert_list: new_convert_list } = await convert();

describe('生成SCL测试', () => {
    describe('配置正确转换', () => {
        it('复制指定文件', async () => {
            ok(find_in_list(copy_list, 'dst', `${context.work_path}/test/AI_Proc.scl`));
            const a_output_file = `${context.work_path}/test/test.yaml`;
            ok(find_in_list(copy_list, 'dst', a_output_file));
            const a_input_file = `${context.work_path}/test.yaml`;
            ok(find_in_list(copy_list, 'content', await read_file(a_input_file)));
        });
        it('检查指定属性', async () => {
            ok(find_in_list(copy_list, 'CPU', 'test'));
            ok(find_in_list(copy_list, 'feature', 'AI'));
            ok(find_in_list(copy_list, 'platform', 'step7'));
        });
        it('生成指定文件', async () => {
            ok(find_in_list(convert_list, 'dst', `${context.work_path}/test/AI_Loop.scl`));
            ok(find_in_list(convert_list, 'content', `测试: AI_Loop\n文件: D:/codes/AS/S7_SCL_Gen/test/test.yaml`));
        });
    });
});

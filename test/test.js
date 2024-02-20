/* eslint-disable no-undef */
import { ok } from "node:assert/strict";
import { chdir, cwd } from 'node:process';
import { posix } from 'node:path';
import { convertRules } from 'gooconverter';
import { context } from '../src/index.js';
import { gen_data } from '../src/gen_data.js';

chdir('./test');
context.work_path = cwd().replace(/\\/g, '/');
const [copy_list, convert_list] = await gen_data({ silent: true });
const gen_files = [];
if (convert_list?.length) {
    let output_dir = context.work_path;
    for (const { rules, template } of convert_list) {
        for (let { name, content } of convertRules(rules, template)) {
            const output_file = posix.join(output_dir, `./${name}`);
            gen_files.push({ output_file, content });
        };
    }
}

describe('生成SCL测试', () => {
    describe('配置正确转换', () => {
        it('复制指定文件', async () => {
            ok(copy_list.find(
                item => item.dst == `${context.work_path}/test/AI_Proc.scl`
            ));
        });
        it('生成指定文件', async () => {
            ok(gen_files.find(
                item => item.output_file == `${context.work_path}/test/AI_Loop.scl`
            ));
        });
    });
});

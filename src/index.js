import { posix } from 'node:path';
import { convertRules } from 'gooconverter';
import { copy_file, read_file, write_file, context } from './util.js'
import { gen_data } from './gen_data.js';

export { convert, context };

async function convert2file(
    { rules, template },
    output_dir,
) {
    // Asynchronous sequential execution 异步顺序执行
    for (let { name, content } of convertRules(rules, template)) {
        const output_file = posix.join(output_dir, `./${name}`);
        await write_file(output_file, content);
        context.silent || console.log(`\t${output_file}`)
    };
}

async function convert() {
    const silent = context.silent;
    silent || console.log(`current conversion folder 当前转换文件夹: ${context.work_path}`);
    const { copy_list, convert_list } = await gen_data();
    if (copy_list?.length) {
        silent || console.log("\ncopy file to: 复制文件至：");
        for (const { src, dst } of copy_list) {
            if (typeof src === 'string') {
                await copy_file(src, dst);
            } else {
                const encoding = src.encoding;
                let content = await read_file(src.filename, { encoding });
                if (content.charCodeAt(0) === 0xFEFF) { // 去掉 BOM
                    content = content.substring(1);
                }
                await write_file(dst, content);
            }
            silent || console.log(`\t${dst}`)
        }
    }
    if (convert_list?.length) {
        let output_dir = context.work_path;
        silent || console.log("\ngenerate file: 生成文件：");
        for (const item of convert_list) {
            await convert2file(item, output_dir);
        }
    }
}
import { posix } from 'node:path';
import { convert as gc } from 'gooconverter';
import { copy_file, read_file, write_file, context } from './util.js'
import { gen_data } from './gen_data.js';
import { supported_features, converter } from './converter.js';

export { convert, context, supported_features, converter };

async function convert() {
    const silent = context.silent;
    silent || console.log(`current conversion folder 当前转换文件夹: ${context.work_path}`);
    const ret = {
        copy_list: [],
        convert_list: [],
    };

    const { copy_list, convert_list } = await gen_data();

    if (copy_list?.length) {
        silent || console.log("\ncopy file to: 复制文件至：");
        for (const { src, dst } of copy_list) {
            if (typeof src === 'string') {
                await copy_file(src, dst);
                ret.copy_list.push({ src, dst });
            } else {
                const encoding = src.encoding;
                let content = await read_file(src.filename, { encoding });
                if (context.OE == 'gbk' && content.charCodeAt(0) === 0xFEFF) { // 去掉 BOM
                    content = content.substring(1);
                }
                await write_file(dst, content);
                ret.copy_list.push({ src, dst, content });
            }
            silent || console.log(`\t${dst}`)
        }
    }

    if (convert_list?.length) {
        let output_dir = context.work_path;
        silent || console.log("\ngenerate file: 生成文件：");
        // Asynchronous sequential execution 异步顺序执行
        for (const { path, tags, template } of convert_list) {
            const content = gc(tags, template);
            const output_file = posix.join(output_dir, `${path}`);
            // 由 noconvert 变量决定是否输出
            context.noconvert || await write_file(output_file, content);
            context.silent || console.log(`\t${output_file}`);
            ret.convert_list.push({ output_file, content });
        }
    }
    return ret;
}
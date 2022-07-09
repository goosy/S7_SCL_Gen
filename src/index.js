import { join } from 'path';
import { convertRules } from 'gooconverter';
import { copy_file, write_file, version, tips } from './util.js'
import { gen_data } from './gen_data.js';

export { convert, copy_file, version, tips };

async function convert2file(
  { rules, template },
  output_dir,
  options = { encoding: "utf8", lineEndings: "linux" }
) {
  const silent = options.silent;
  // for-of 实现异步顺序执行
  for (let { name, content } of convertRules(rules, template)) {
    const output_file = join(output_dir, `./${name}`);
    await write_file(output_file, content, options)
    silent || console.log(`\t${output_file}`)
  };
}

async function convert(options) {
  const work_path = process.cwd();
  const silent = options.silent;
  silent || console.log(`${work_path}:`);
  const [copy_list, convert_list] = await gen_data(options);
  if (copy_list?.length) {
    silent || console.log("copy file to:");
    for (const { src, dst, desc } of copy_list) {
      await copy_file(src, dst);
      silent || console.log(`\t${desc}`)
    }
  }
  if (convert_list?.length) {
    const OPT = { encoding: 'gbk', lineEndings: "windows" };
    let output_dir = work_path;
    silent || console.log("generate file:");
    for (const item of convert_list) {
      await convert2file(item, output_dir, { ...OPT, ...options });
    }
  }
}
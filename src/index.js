import { convertRules } from 'gooconverter';
import { join } from 'path';

import { copy_file, write_file } from './util.js'
import { gen_data } from './gen_data.js';

async function convert2file(
  { rules, template },
  path,
  options = { encoding: "utf8", lineEndings: "linux" }
) {
  // for-of 实现异步顺序执行
  for (let { name, content } of convertRules(rules, template)) {
    const output_file = join(path, `./${name}`);
    await write_file(output_file, content, options)
    console.log(`\t${output_file}`)
  };
}

export async function convert() {
  const work_path = process.cwd();
  console.log(`${work_path}:`);
  const [copy_list, convert_list] = await gen_data();
  console.log("copy file to:");
  for (const [src, dst, desc] of copy_list) {
    await copy_file(src, dst);
    console.log(`\t${desc}`)
  }

  const OPT = { encoding: 'gbk', lineEndings: "windows" };
  let output_dir = work_path;
  console.log("generate file:");
  for (const item of convert_list) {
    await convert2file(item, output_dir, OPT);
  }
}

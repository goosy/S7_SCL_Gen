import { convertRules } from 'gooconverter';
import { access, mkdir, copyFile, writeFile } from 'fs/promises';
import iconv from 'iconv-lite';

import { gen_data } from './gen_data.js';
import { gen_symbol, AI_NAME, MB340_NAME, MB341_NAME, MT_NAME, VALVE_NAME } from "./symbols.js";
import { gen_AI } from "./AI.js";
import { gen_MB } from "./MB.js";
import { gen_MT } from "./MT.js";
import { gen_valve } from "./valve.js";

import { fileURLToPath } from 'url';
import { basename, dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let work_path = './conf/'; // 工作目录

async function prepare_dir(dir) {
  let parents = dirname(dir);
  await access(parents).catch(async () => {
    await prepare_dir(parents);
  });
  await access(dir).catch(async () => {
    await mkdir(dir).catch(
      err => {
        if (err.code !== 'EEXIST') console.log(err);
      }
    );
  });
}

/**
 * 复制文件
 * 目标为文件夹时，以'/'结尾
 * @date 2021-09-28
 * @param {string} file
 * @param {string|string[]} dstList
 */
async function copy(file, dstList) {
  async function _copy(src, dst) {
    if (typeof src != 'string') return;
    if (typeof dst != 'string') return;
    if (dst.endsWith('/')) {
      dst += basename(file);
    }
    let srcPath = join(__dirname, src);
    let dstPath = join(work_path, dst);
    await prepare_dir(dirname(dstPath));
    await copyFile(srcPath, dstPath);
  }
  if (!Array.isArray(dstList)) dstList = [dstList];
  for (const dst of dstList) { // for-of 实现异步顺序执行
    await _copy(file, dst);
  }
}

async function convert2file(entry, path, {
  "OE": OE = "utf8",
  "lineEndings": lineEndings = "linux"
} = {
    "OE": "utf8",
    "lineEndings": "linux"
  }) {
  let { rules, template } = entry;
  // for-of 实现异步顺序执行
  for (let { name, content } of convertRules(rules, template)) {
    let output_file = join(path, `./${name}`);
    await prepare_dir(dirname(output_file));
    if (lineEndings == "windows") content = content.replace(/\n/g, "\r\n");
    let buff = iconv.encode(content, OE);
    await writeFile(output_file, buff);
    console.log(`output file ${output_file}`)
  };
}

export async function convert(conf_path) {
  work_path = conf_path ?? work_path;
  console.log(`${work_path}:`);
  const { symbols_confs, MB_confs, MT_confs, AI_confs, valve_confs } = await gen_data(work_path);
  const symbol_asc = gen_symbol(symbols_confs);
  const ai = gen_AI(AI_confs);
  const mb = gen_MB(MB_confs);
  const mt = gen_MT(MT_confs);
  const valve = gen_valve(valve_confs);

  for (const { CPU: { output_dir } } of AI_confs) {
    await copy(AI_name + '.scl', `${output_dir}/`)
    console.log(`output file ${join(output_dir, AI_name)}.scl`)
  }
  for (const { CPU: { output_dir }, options: { has_CP341, has_CP340 } } of MB_confs) {
    if (has_CP340) {
      await copy(MB340_name + '.scl', `${output_dir}/`)
      console.log(`output file ${join(output_dir, MB340_name)}.scl`)
    }
    if (has_CP341) {
      await copy(MB341_name + '.scl', `${output_dir}/`)
      console.log(`output file ${join(output_dir, MB341_name)}.scl`)
    }
  }
  for (const { CPU: { output_dir } } of MT_confs) {
    await copy(MT_name + '.scl', `${output_dir}/`)
    console.log(`output file ${join(output_dir, MT_name)}.scl`)
  }
  for (const { CPU: { output_dir } } of valve_confs) {
    await copy(valve_name + '.scl', `${output_dir}/`)
    console.log(`output file ${join(output_dir, valve_name)}.scl`)
  }

  const OPT = { "OE": 'gbk', "lineEndings": "windows" };
  let output_dir = work_path;
  await convert2file(ai, output_dir, OPT);
  await convert2file(symbol_asc, output_dir, OPT);
  await convert2file(mb, output_dir, OPT);
  await convert2file(mt, output_dir, OPT);
  await convert2file(valve, output_dir, OPT);
}

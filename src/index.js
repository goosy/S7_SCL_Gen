import { convertRules } from 'gooconverter';
import { join } from 'path';

import { copy, write_file } from './util.js'
import { gen_data } from './gen_data.js';
import { gen_symbol, AI_NAME, CP340_NAME, CP341_NAME, MT_NAME, VALVE_NAME } from "./symbols.js";
import { gen_AI } from "./AI.js";
import { gen_CP } from "./CP.js";
import { gen_MT } from "./MT.js";
import { gen_valve } from "./valve.js";

async function convert2file(entry, path, options = { encoding: "utf8", lineEndings: "linux" }) {
  let { rules, template } = entry;
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
  const { symbols_confs, CP_confs, MT_confs, AI_confs, valve_confs } = await gen_data(work_path);
  const symbol_asc = gen_symbol(symbols_confs);
  const ai = gen_AI(AI_confs);
  const mb = gen_CP(CP_confs);
  const mt = gen_MT(MT_confs);
  const valve = gen_valve(valve_confs);

  console.log("copy file to:");
  for (const { CPU: { output_dir } } of AI_confs) {
    await copy(`AI_Proc/${AI_NAME}(step7).scl`, `${output_dir}/${AI_NAME}.scl`)
    console.log(`\t${join(work_path, output_dir, AI_NAME)}.scl`)
  }
  for (const { CPU: { output_dir }, options: { has_CP341, has_CP340 } } of CP_confs) {
    if (has_CP340) {
      await copy(`CP_Poll/${CP340_NAME}.scl`, `${output_dir}/`)
      console.log(`\t${join(work_path, output_dir, CP340_NAME)}.scl`)
    }
    if (has_CP341) {
      await copy(`CP_Poll/${CP341_NAME}.scl`, `${output_dir}/`)
      console.log(`\t${join(work_path, output_dir, CP341_NAME)}.scl`)
    }
  }
  for (const { CPU: { output_dir } } of MT_confs) {
    await copy(`MT_Poll/${MT_NAME}.scl`, `${output_dir}/`)
    console.log(`\t${join(work_path, output_dir, MT_NAME)}.scl`)
  }
  for (const { CPU: { output_dir } } of valve_confs) {
    await copy(`Valve_Proc/${VALVE_NAME}.scl`, `${output_dir}/`)
    console.log(`\t${join(work_path, output_dir, VALVE_NAME)}.scl`)
  }

  const OPT = { encoding: 'gbk', lineEndings: "windows" };
  let output_dir = work_path;
  console.log("generate file:");
  await convert2file(ai, output_dir, OPT);
  await convert2file(symbol_asc, output_dir, OPT);
  await convert2file(mb, output_dir, OPT);
  await convert2file(mt, output_dir, OPT);
  await convert2file(valve, output_dir, OPT);
}

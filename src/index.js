import { convertRules } from 'gooconverter';
import fs from 'fs/promises';
import iconv from 'iconv-lite';

import { fileURLToPath } from 'url';
import { basename, dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { MB_confs, MT_confs, AI_confs, valve_confs } from './gen_data.js';
import * as symbol_asc from "./gen_symbol.js";
import * as mt_loop from "./gen_MT_Loop.js";
import * as mb_loop from "./gen_MB_Loop.js";
import * as ai_loop from "./gen_AI_Loop.js";
import * as valve_loop from "./gen_valve_loop.js";

async function prepare_dir(dir) {
	let parents = dirname(dir);
	await fs.access(parents).catch(async () => {
		await prepare_dir(parents);
	});
	await fs.access(dir).catch(async () => {
		await fs.mkdir(dir).catch(
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
async function copyFile(file, dstList) {
	async function copy(src, dst) {
		if (typeof src != 'string') return;
		if (typeof dst != 'string') return;
		if (dst.endsWith('/')) {
			dst += basename(file);
		}
		let srcPath = join(__dirname, src);
		let dstPath = join(__dirname, dst);
		await prepare_dir(dirname(dstPath));
		await fs.copyFile(srcPath, dstPath);
	}
	if (!Array.isArray(dstList)) dstList = [dstList];
	for (const dst of dstList) { // for-of 实现异步顺序执行
		await copy(file, dst);
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
		await fs.writeFile(output_file, buff);
	};
}

for (const { CPU: { output_dir } } of AI_confs) {
	await copyFile('AI_Proc.scl', `../dist/${output_dir}/`)
}
for (const { CPU: { output_dir }, options: { MB340_FB, MB341_FB } } of MB_confs) {
	if (MB340_FB) await copyFile(MB340_FB?.name ?? 'MB_340_Poll.SCL', `../dist/${output_dir}/`)
	if (MB341_FB) await copyFile(MB341_FB?.name ?? 'MB_341_Poll.SCL', `../dist/${output_dir}/`)
}
for (const { CPU: { output_dir }, options: { MB_TCP_Poll } } of MT_confs) {
	const name = MB_TCP_Poll?.name ?? 'MB_TCP_Poll';
	await copyFile(name + '.SCL', `../dist/${output_dir}/`)
}
for (const { CPU: { output_dir } } of valve_confs) {
	await copyFile('Valve_Proc.scl', `../dist/${output_dir}/`)
}

const OPT = { "OE": 'gbk', "lineEndings": "windows" };
let output_dir = join(__dirname, '../dist/');
await convert2file(symbol_asc, output_dir, OPT);
await convert2file(mt_loop, output_dir, OPT);
await convert2file(mb_loop, output_dir, OPT);
await convert2file(ai_loop, output_dir, OPT);
await convert2file(valve_loop, output_dir, OPT);
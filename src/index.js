import { convertRules } from 'gooconverter';
import fs from 'fs/promises';
import iconv from 'iconv-lite';

import { fileURLToPath } from 'url';
import { basename, dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import * as symbol_asc from "./symbol.asc.js";
import * as mt_loop from "./MT_Loop.js";

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

const OPT = { "OE": 'gbk', "lineEndings": "windows" };
let output_dir = join(__dirname, '../dist/');
await convert2file(symbol_asc, output_dir, OPT);
await convert2file(mt_loop, output_dir, OPT);
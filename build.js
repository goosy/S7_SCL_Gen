import { join } from 'path';
import { readdir, readFile } from 'fs/promises';
import { module_path, write_file } from './src/util.js';
import { convertRules } from 'gooconverter';
import { rollup } from 'rollup';
import pkg from './package.json' assert { type: 'json' };
import { builtinModules } from 'module';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const inputOptions = {
    input: './src/index.js',
    plugins: [
        resolve({
            preferBuiltins: true,
        }), // tells Rollup how to find XX in node_modules
        commonjs(), // converts XX to ES modules
    ],
    external: [...builtinModules, 'iconv-lite', '**/package.json'],
};

const outputOptionsList = [{
    file: pkg.exports['.'][0].import,
    format: 'es',
    // }, {
    //     file: pkg.exports['.'][0].require,
    //     format: 'cjs',
}];

async function build() {
    // build src/converter.js
    const supported_types = (await readdir(join(module_path, 'src/converters'))).map(
        file => file.replace(/\.js$/, '')
    );
    const rules = [{
        "name": `converter.js`,
        "tags": {
            supported_types,
        }
    }];
    const template = await readFile('src/converter.template', { encoding: 'utf8'});
    for (let { name, content } of convertRules(rules, template)) {
        const output_file = join(module_path, 'src', name);
        await write_file(output_file, content, {});
        console.log(`created ${output_file}`);
    };
    console.log(`file src/converter.js generated!`);

    // build bundle files
    let bundle;
    let buildFailed = false;
    try {
        bundle = await rollup(inputOptions);
        // bundle.watchFiles is an array of file names this bundle depends on
        await generateOutputs(bundle);
    } catch (error) {
        buildFailed = true;
        // do some error reporting
        console.error(error);
    }
    if (bundle) {
        // closes the bundle
        await bundle.close();
    }
    process.exit(buildFailed ? 1 : 0);
}

async function generateOutputs(bundle) {
    for (const outputOptions of outputOptionsList) {
        const { output } = await bundle.write(outputOptions);
        console.log(`file ${outputOptions.file} generated!`);
    }
}

build();

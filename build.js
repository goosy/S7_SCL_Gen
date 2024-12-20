import { readdir } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { posix } from 'node:path';
import { convert } from 'gooconverter';
import { rollup } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import pkg from './package.json' with { type: 'json' };
import { context, read_file, write_file, pad_right } from './src/util.js';

const mainInputOptions = {
    input: './src/index.js',
    plugins: [
        resolve({ preferBuiltins: true }),
        commonjs(), // converts XX to ES modules
        json(),
    ],
    external: [...builtinModules, 'iconv-lite'],
};

const mainOutputOptionsList = [{
    file: pkg.exports['.'][0].import,
    format: 'es',
}];

const CLIInputOptions = {
    input: './src/cli.js',
    plugins: [
        resolve({ preferBuiltins: true }),
        commonjs(), // converts XX to ES modules
        json(),
    ],
    external: [...builtinModules, 'iconv-lite', 'nodemon', './index.js'],
};

const CLIOutputOptionsList = [{
    file: pkg.bin.s7scl,
    format: 'es',
    banner: '#!/usr/bin/env node',
}];

function get_module_path(...filename) {
    return posix.join(context.module_path, ...filename);
}

async function build() {
    // create fake src/symbols_buildin.yaml
    await write_file(get_module_path('src', 'symbols_buildin.yaml'), '', { encoding: 'utf8', line_ending: 'LF' });

    const files = (await readdir(get_module_path('src', 'converters')))
    const js_files = files.filter(
        file => file.startsWith('converter_') && file.endsWith('.js')
    );
    const yaml_files = files.filter(
        file => file.endsWith('.yaml')
    );
    const template_files = files.filter(
        file => file.endsWith('.template')
    );

    const features = [];
    for (const file of js_files) {
        const feature = file.replace('converter_', '').replace(/\.js$/, '');
        if (feature === 'CPU') features.unshift(feature); //Ensure that CPU is first
        else features.push(feature);
    }

    const converters = {};
    for (const feature of features) {
        const converter = await import(`./src/converters/converter_${feature}.js`);
        converters[feature] = converter;
        for (const method of ['is_feature', 'initialize_list', 'gen', 'gen_copy_list']) {
            if (typeof converter[method] !== 'function') {
                throw new Error(`there is no ${method} function in ${feature}.js file.`);
            }
        }
    }

    const templates = {};
    for (const file of template_files) {
        templates[file] = await read_file(get_module_path('src', 'converters', file), { encoding: 'utf8' });
    };

    // build src/symbols_buildin.yaml
    const yamls = [];
    for (const [feature, converter] of Object.entries(converters)) {
        if (yaml_files.includes(`${feature}.yaml`)) {
            const yaml_raw = await read_file(get_module_path('src', 'converters', `${feature}.yaml`), { encoding: 'utf8' });
            const yaml = convert(
                converter,
                yaml_raw.replace('BUILDIN', `BUILDIN-${feature}`).trim()
            );
            yamls.push(yaml);
        } else {
            yamls.push(`name: BUILDIN-${feature}\nsymbols: []`);
        }
    }
    const buildin_yaml = `---\n\n${yamls.join('\n\n---\n\n')}\n\n...\n`;
    const dst_yaml_files = [
        get_module_path('src', 'symbols_buildin.yaml'),
        get_module_path('lib', 'symbols_buildin.yaml')
    ];
    for (const yaml_file of dst_yaml_files) {
        await write_file(
            yaml_file,
            buildin_yaml,
            { encoding: 'utf8', line_ending: 'LF' }
        );
        console.log(`file ${yaml_file} generated!`);
    }

    // build src/converter.js
    const dst_converter_filename = get_module_path('src', 'converter.js');
    await write_file(
        dst_converter_filename,
        convert( // convert the content of src/converter.template
            { features, templates, pad_right },
            await read_file(get_module_path('src', 'converter.template'), { encoding: 'utf8' }),
        ),
        { encoding: 'utf8', line_ending: 'LF' }
    );
    console.log(`file ${dst_converter_filename} generated!`);

    // build bundle files
    let main_bundle;
    let cli_bundle;
    let buildFailed = false;
    try {
        main_bundle = await rollup(mainInputOptions);
        await generateOutputs(main_bundle, mainOutputOptionsList);
        cli_bundle = await rollup(CLIInputOptions);
        await generateOutputs(cli_bundle, CLIOutputOptionsList);
    } catch (error) {
        buildFailed = true;
        // do some error reporting
        console.error(error);
    }
    if (main_bundle) await main_bundle.close();
    if (cli_bundle) await cli_bundle.close();
    process.exit(buildFailed ? 1 : 0);
}

async function generateOutputs(bundle, outputOptionsList) {
    for (const outputOptions of outputOptionsList) {
        await bundle.write(outputOptions);
        console.log(`file ${outputOptions.file} generated!`);
    }
}

build();

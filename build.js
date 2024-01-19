import { posix } from 'path';
import { readdir, readFile } from 'fs/promises';
import { context, write_file } from './src/util.js';
import { convert } from 'gooconverter';
import { rollup } from 'rollup';
import pkg from './package.json' assert { type: 'json' };
import { builtinModules } from 'module';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const mainInputOptions = {
    input: './src/index.js',
    plugins: [
        resolve({
            preferBuiltins: true,
        }), // tells Rollup how to find XX in node_modules
        commonjs(), // converts XX to ES modules
    ],
    external: [...builtinModules, 'iconv-lite', '**/package.json'],
};

const mainOutputOptionsList = [{
    file: pkg.exports['.'][0].import,
    format: 'es',
}];

const CLIInputOptions = {
    input: './src/cli.js',
    plugins: [
        resolve({
            preferBuiltins: true,
        }), // tells Rollup how to find XX in node_modules
        commonjs(), // converts XX to ES modules
    ],
    external: [...builtinModules, 'nodemon', './index.js'],
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
    await write_file(get_module_path('src', 'symbols_buildin.yaml'), '');

    const files = await readdir(get_module_path('src', 'converters'));
    const features = [];
    files.filter(file => file.startsWith('converter_') && file.endsWith('.js')).forEach(file => {
        const feature = file.replace('converter_', '').replace(/\.js$/, '');
        if (feature === 'CPU') features.unshift(feature); //保证CPU为第一个
        else features.push(feature);
    });

    const converters = {};
    for (const feature of features) {
        const converter = await import(`./src/converters/converter_${feature}.js`);
        converters[feature] = converter;
        [
            'is_feature',
            'initialize_list',
            'gen',
            'gen_copy_list'
        ].forEach(method => {
            if (typeof converter[method] !== 'function') {
                throw new Error(`there is no ${method} function in ${feature}.js file.`);
            }
        })
    }
    const supported_category = features.map(feature =>
        ({ feature, platforms: JSON.stringify(converters[feature].platforms) })
    );

    // build src/symbols_buildin.yaml
    const yamls = [];
    for (const [feature, converter] of Object.entries(converters)) {
        if (files.includes(`${feature}.yaml`)) {
            const yaml_raw = await readFile(get_module_path('src', 'converters', `${feature}.yaml`), { encoding: 'utf8' });
            const yaml = convert(
                converters[feature],
                yaml_raw.replace('BUILDIN', `BUILDIN-${feature}`).trim()
            );
            yamls.push(yaml);
        } else {
            yamls.push(`name: BUILDIN-${feature}\nsymbols: []`);
        }
    }
    const buildin_yaml = '---\n\n' + yamls.join('\n\n---\n\n') + '\n\n...\n';
    const filenames = [
        get_module_path('src', 'symbols_buildin.yaml'),
        get_module_path('lib', 'symbols_buildin.yaml')
    ];
    for (const filename of filenames) {
        await write_file(
            filename,
            buildin_yaml,
            { encoding: 'utf8' }
        );
        console.log(`file ${filename} generated!`);
    }

    // build src/converter.js
    const filename = get_module_path('src', 'converter.js');
    await write_file(
        filename,
        convert( // convert the content of src/converter.template
            { converters, supported_category },
            await readFile('src/converter.template', { encoding: 'utf8' })
        ),
        { encoding: 'utf8' }
    );
    console.log(`file ${filename} generated!`);

    // build bundle files
    let main_bundle, cli_bundle;
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

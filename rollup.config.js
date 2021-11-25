import pkg from './package.json';
import { builtinModules } from 'module';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';

const external = [
    ...builtinModules,
    'iconv-lite',
    '/.*\/conf\/.*$/',
];
export default { // main lib
    input: './src/index.js',
    output: [{
        file: pkg.exports['.'][0].import,
        format: 'es',
    }, {
        file: pkg.exports['.'][0].require,
        format: 'cjs',
    }],
    plugins: [
        resolve({
            preferBuiltins: true,
        }), // tells Rollup how to find XX in node_modules
        commonjs(), // converts XX to ES modules
        copy({
            targets: [
                { src: './src/AI_Proc.scl', dest: './lib/' },
                { src: './src/Valve_Proc.scl', dest: './lib/' },
                { src: './src/MB_340_Poll.scl', dest: './lib/' },
                { src: './src/MB_341_Poll.scl', dest: './lib/' },
                { src: './src/MB_TCP_Poll.scl', dest: './lib/' },
            ]
        }),
    ],
    external,
}
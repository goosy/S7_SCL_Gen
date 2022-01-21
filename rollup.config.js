import pkg from './package.json';
import { builtinModules } from 'module';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

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
    // }, {
    //     file: pkg.exports['.'][0].require,
    //     format: 'cjs',
    }],
    plugins: [
        resolve({
            preferBuiltins: true,
        }), // tells Rollup how to find XX in node_modules
        commonjs(), // converts XX to ES modules
    ],
    external,
}
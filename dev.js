import { convert, context } from './src/index.js';
import mri from 'mri';

const argv = mri(process.argv.slice(2), {
    boolean: ['help', 'version'],
    alias: {
        H: 'help',
        V: 'version',
        Z: ['z', 'zyml-only'],
    }
});
const output_zyml = argv['zyml-only'] || argv['output-zyml'];
if (output_zyml) context.output_zyml = output_zyml;
const noconvert = argv['zyml-only'];
if (noconvert) context.noconvert = noconvert;
const silent = argv.silent;
if (silent) context.silent = silent;
const encoding = argv.encoding;
if (encoding) context.encoding = encoding;
const lineEndings = argv['line-endings'];
if (lineEndings) context.lineEndings = lineEndings;
process.chdir('./example');
context.work_path = process.cwd().replace(/\\/g, '/');
await convert();
if (!noconvert) console.log("\nconverted all YAML to SCL!")
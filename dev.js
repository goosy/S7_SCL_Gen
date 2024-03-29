import { convert, context } from './src/index.js';
import mri from 'mri';

const argv = mri(process.argv.slice(2), {
    boolean: ['help', 'version', 'zyml-only', 'output-zyml'],
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
const encoding = argv.OE;
if (encoding) context.OE = encoding;
const line_ending = argv['line-ending'];
if (line_ending) context.line_ending = line_ending;
process.chdir('./example');
context.work_path = process.cwd().replace(/\\/g, '/');
await convert();
if (!noconvert) console.log("\nconverted all YAML to SCL!")
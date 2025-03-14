import { convert, context } from './src/index.js';
import { get_rules } from './src/rules/index.js';
import mri from 'mri';

const argv = mri(process.argv.slice(2), {
    boolean: ['help', 'version', 'zyml-only', 'output-zyml'],
    alias: {
        H: 'help',
        V: 'version',
        Z: ['z', 'zyml-only'],
    }
});
const output_zyml = argv['output-zyml'];
if (output_zyml) context.output_zyml = output_zyml;
const no_convert = argv['no-convert'];
if (no_convert) context.no_convert = no_convert;
const no_copy = argv['no-copy'];
if (no_copy) context.no_copy = no_copy;
const silent = argv.silent;
if (silent) context.silent = silent;
const encoding = argv.OE;
if (encoding) context.OE = encoding;
const line_ending = argv['line-ending'];
if (line_ending) context.line_ending = line_ending;
process.chdir('./example');
context.work_path = process.cwd().replace(/\\/g, '/');
await convert();
if (!no_convert) console.log("\nconverted all YAML to SCL!");

const tasks = await get_rules('./alarms.rml');
for (const { rules } of tasks) {
    await convert(rules);
}

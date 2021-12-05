import { convert } from './src/index.js';

process.chdir('./conf');
await convert();
console.log("converted all YAML to SCL!")
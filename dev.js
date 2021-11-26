import { convert } from './src/index.js';

const path = './conf';
await convert(path);
console.log("converted all YAML to SCL!")
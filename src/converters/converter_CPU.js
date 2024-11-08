import assert from 'node:assert/strict';
import { convert } from 'gooconverter';
import { add_symbols, make_s7_expression } from '../symbols.js';
import { STRING, nullable_value } from '../s7data.js';
import { elog } from '../util.js';

export const NAME = 'CPU';
export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
const feature = 'CPU';

export const devices = [
    "IM151-8PN/DP",
    "CPU31x-2PN/DP",
    "CPU314C-2PN/DP",
    "CPU317-2PN/DP",
    "IM154-8PN/DP",
    "CPU319-3PN/DP",
    "CPU315T-3PN/DP",
    "CPU317T-3PN/DP",
    "CPU317TF-3PN/DP",
    "CPU412-2PN",
    "CPU414-3PN/DP",
    "CPU416-3PN/DP",
    "CPU412-5H_PN/DP",
    "CPU414-5H_PN/DP",
    "CPU416-5H_PN/DP",
    "CPU417-5H_PN/DP",
    "CPU410-5H",
];
const DEFAULT_DEVICE = "CPU31x-2PN/DP"; //默认的CPU设备

export function is_feature(name) {
    return name.toUpperCase() === feature;
}

/**
 * 第一遍扫描 提取符号
 * @date 2022-02-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    const CPU = document.CPU;
    const CM = CPU.symbols.get("Clock_Byte");
    if (CM) {
        assert(/^mb\d+$/i.test(CM.address), new SyntaxError(`${CPU.name}-CPU:符号 Clock_Byte 的地址 "${CM.address}" 无效！`));
        const CM_address = CM.address.substring(2);
        CM.comment ||= 'clock memory';
        const symbols = [
            ['Clock_10Hz', `M${CM_address}.0`],
            ['Clock_5Hz', `M${CM_address}.1`],
            ['Clock_2.5Hz', `M${CM_address}.2`],
            ['Clock_2Hz', `M${CM_address}.3`],
            ['Clock_1.25Hz', `M${CM_address}.4`],
            ['Clock_1Hz', `M${CM_address}.5`],
            ['Clock_0.625Hz', `M${CM_address}.6`],
            ['Clock_0.5Hz', `M${CM_address}.7`],
        ];
        add_symbols(document, symbols);
    }
    CPU.device = nullable_value(STRING, document.get('device'))?.value ?? 'CPU31x-2_PN/DP';
    if (CPU?.device?.startsWith("CPU31")) {
        // 修改300CPU的内置符号 GET PUT
        const symbols = [
            ['GET', 'FB14'],
            ['PUT', 'FB15']
        ];
        add_symbols(document, symbols);
    }
    CPU.S7Program = nullable_value(STRING, document.get('S7Program'))?.value ?? 'S7Program';
    area.list = area.list.map(node => {
        const FN = { node, comment: new STRING(node.get('comment') ?? '') };
        const comment = FN.comment.value;
        const block = node.get('block');
        if (!block) elog(new SyntaxError(`${CPU.name}-CPU: 转换配置项必须有block!`));
        //S7函数类型
        make_s7_expression(
            block,
            {
                document,
                disallow_s7express: true,
                default: { comment },
            },
        ).then(
            ret => FN.block = ret
        );
        FN.title = nullable_value(STRING, node.get('title'));
        FN.code = new STRING(node.get('code') ?? '');
        return FN;
    });
}

export function build_list({ document, list, options }) {
    const CPU = document.CPU;
    list.forEach(FN => {
        if (!['OB', 'FC'].includes(FN.block.block_name)) elog(new SyntaxError(`${CPU.name}-CPU: 转换配置项block必须是一个 OB 或 FC 符号!`));
    });
    if (options.output_dir) {
        CPU.output_dir = convert({
            cpu_name: CPU.name,
            platform: CPU.platform,
            device: CPU.device
        }, options.output_dir);
    }
}

export function gen({ document, includes, list, options = {} }) {
    const { CPU } = document;
    const { output_dir } = CPU;
    const { output_file = NAME + '.scl' } = options;
    if (includes.length || list.length) {
        const path = `${output_dir}/${output_file}`;
        const tags = {}
        const template = 'CPU.template';
        return [{ path, tags, template }];
    };
    return [];
}

export function gen_copy_list() {
    return [];
}

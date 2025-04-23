/**
 * serial processing
 * Provide 3 functions according to 3 stages: get_symbols_CP build_CP gen_CP
 * @file SC
 */

import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { isSeq } from 'yaml';
import { context, fixed_hex, parse_hex_array, elog } from '../util.js';
import { BOOL, STRING, PINT, ensure_value, nullable_value } from '../s7data.js';
import { make_s7_expression } from '../symbols.js';

export const platforms = ['step7']; // platforms supported by this feature
export const CP340_NAME = 'CP340_Poll';
export const CP341_NAME = 'CP341_Poll';
export const LOOP_NAME = 'SC_Loop';
export const CRC = 'CRC16';
export const POLLS_NAME = 'SC_polls_DB';
export const TIMEOUT = 2000;
const feature = 'SC';

export function is_feature(name) {
    const f_name = name.toUpperCase();
    return f_name === feature || f_name === 'MB';
}

/**
 * @typedef {object} S7Item
 * @property {Object} CPU
 * @property {Array} list
 * @property {Object} Options
 * @property {Array|string} includes
 */

/**
 * First scan to extract symbols
 * @date 2021-12-07
 * @param {S7Item} SC_area
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    const CPU = document.CPU;
    const options = area.options;
    area.list = area.list.map((node, index) => {
        const module = {
            node,
            name: nullable_value(STRING, node.get('name') ?? node.get('polls_name')),
            comment: ensure_value(STRING, node.get('comment') ?? ''),
            model: ensure_value(STRING, node.get('model') ?? 'CP341'),
            try_times: nullable_value(PINT, node.get('try_times')),
            retry_times: nullable_value(PINT, node.get('retry_times')),
        };

        const comment = module.comment.value;

        const type = (model => {
            if (model === 'CP341') {
                options.has_CP341 = true;
                return CP341_NAME;
            }
            if (model === 'CP340') {
                options.has_CP340 = true;
                return CP340_NAME;
            }
            elog(new SyntaxError(`${CPU.name}:SC:module${comment} 的类型 "${module.model}" 不支持`));
        })(module.model.value);

        let module_symbol = node.get('module');
        const module_addr = nullable_value(PINT, node.get('module_addr'));
        assert(module_symbol || module_addr, new SyntaxError(`${CPU.name}:SC:module(${comment}) 未提供 module 或 module_addr!`));
        module_symbol ??= [`CP${index + 1}_addr`, `IW${module_addr.value}`];
        make_s7_expression(
            module_symbol,
            {
                document,
                disallow_s7express: true,
                force: { type: 'WORD' },
                default: { comment: 'HW module address' },
            },
        ).then(symbol => {
            module.module = symbol;
        });

        const DB = node.get('DB');
        assert(DB, new SyntaxError(`${CPU.name}:SC 第${index + 1}个 module 没有正确定义背景块!`));
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type },
                default: { comment },
            },
        ).then(symbol => {
            module.DB = symbol;
            const name = symbol.name;
            assert(/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name), new SyntaxError(`DB name "${name}" is a invalid identifier!`));
            // Check the uniqueness of connection DB within the CPU range
            CPU.SC_DBs ??= new Set();
            if (CPU.SC_DBs.has(name)) {
                throw new SyntaxError(`DB name "${name}" is not unique!`);
            }
            CPU.SC_DBs.add(name);
        });

        const polls = node.get('polls');
        assert(isSeq(polls), SyntaxError(`配置项"polls"必须为数组且个数大于0!`));
        module.polls = polls.items.map(item => {
            const poll = {
                enable: nullable_value(BOOL, item.get('enable')),
                custom_trigger: nullable_value(BOOL, item.get('custom_trigger')),
                comment: ensure_value(STRING, item.get('comment') ?? ''),
                recv_start: ensure_value(PINT, item.get('recv_start'),
                    'recv_start must be gaven and be a positive integer!\n' +
                    '配置项 recv_start 必须提供并且是一个正整数!'
                ),
                extra_code: nullable_value(STRING, item.get('extra_code')),
                timeout: ensure_value(PINT, item.get('timeout') ?? TIMEOUT),
            };
            const comment = poll.comment.value;
            const recv_DB = item.get('recv_DB');
            make_s7_expression(
                recv_DB,
                {
                    document,
                    disallow_s7express: true,
                    default: { comment },
                },
            ).then(symbol => {
                poll.recv_DB = symbol;
            });

            const request = item.get('request');
            if (request) make_s7_expression(
                request,
                {
                    document,
                },
            ).then(symbol => {
                poll.request = symbol;
            });

            const send_DB = item.get('send_DB');
            poll.extra_send_DB = send_DB != null;
            make_s7_expression(
                send_DB ?? POLLS_NAME,
                {
                    document,
                    disallow_s7express: true,
                    default: { comment },
                },
            ).then(symbol => {
                poll.send_DB = symbol;
            });

            const send_data = item.get('send_data');
            poll.is_modbus = nullable_value(BOOL, item.get('is_modbus'))?.value ?? !send_data;
            const unit_ID = item.get('unit_ID');
            const func_code = item.get('func_code');
            const started_addr = item.get('started_addr');
            const address = item.get('address');
            const data = item.get('data');
            const length = item.get('length');
            if (poll.extra_send_DB) {
                assert(
                    send_data == null && unit_ID == null,
                    'send_DB, send_data and unit_ID is conflict!\n' +
                    '配置项 unit_ID、send_data 和 send_DB 只能存在1个!'
                );
                poll.send_start = ensure_value(PINT, item.get('send_start'),
                    'when an external send block is present, send_start must be gaven and be a positive integer!\n' +
                    '当指定外部发送块时，配置项 send_start 必须提供并且是一个正整数!'
                );
            } else if (send_data) {
                assert(
                    unit_ID == null,
                    'send_DB, send_data and unit_ID is conflict!\n' +
                    '配置项 unit_ID、send_data 和 send_DB 只能存在1个!'
                );
                const send_data_desc = 'send_data must be a space-separated hexadecimal string!\n' +
                    '配置项 send_data 必须是一个由空格分隔的16进制字符串!';
                poll.send_data = parse_hex_array(send_data,
                    `"send_data:${send_data}"\n${send_data_desc}`
                );
            } else if (unit_ID) {
                assert(
                    poll.is_modbus === true,
                    'if unit_ID were present, is_modbus must be true!\n' +
                    '如果提供了配置项 unit_ID, is_modbus 只能为真!'
                );
                // When there is no external send block but send_data, unit_ID, func_code, started_addr and data must be present
                poll.unit_ID = ensure_value(PINT, unit_ID,
                    'Either send_DB, send_data or unit_ID must be present! and unit_ID must be a positive integer!\n' +
                    '配置项 send_DB、send_data 或 unit_ID 必须有一个! unit_ID 必须是一个正整数!'
                );
                poll.func_code = ensure_value(PINT, func_code,
                    'when send_DB is present, func_code must be gaven and be a positive integer!\n' +
                    '当指定 send_DB 时，配置项 func_code 必须提供并且是一个正整数!'
                );
                poll.address = ensure_value(PINT, started_addr ?? address,
                    'Either configuration item address or started_addr must be present!\n' +
                    '配置项 address 或 started_addr 必须有一个!'
                );
                poll.data = ensure_value(PINT, data ?? length,
                    'Either configuration item data or length must be present!\n' +
                    '配置项 data 或 length 必须有一个!'
                );
                const fc = poll.func_code.value;
                if (fc === 15 || fc === 16) {
                    const extra_data = ensure_value(STRING, item.get('extra_data'),
                        'When the function code is 15 or 16, the extra_data configuration item must be present!',
                    );
                    poll.extra_data = parse_hex_array(extra_data.value,
                        `"extra_data:${extra_data}"\n配置项 extra_data 必须是一个由空格分隔的16进制字符串!`
                    );
                    poll.extra_data_length = new PINT(poll.extra_data.length);
                }
            } else elog( // poll configuration wrong!
                'Either send_DB, poll.unit_ID or poll.send_data must be present!\n' +
                'send_DB、poll.unit_ID 和 poll.send_data 必须提供且只提供一个!'
            );
            return poll;
        });
        return module;
    })
}

/**
 * Second scan to create data and check for errors
 * @param {S7Item} SC
 * @returns {void}
 */
export function build_list(SC) {
    const { document, list, options } = SC;
    const CPU = document.CPU;
    const DBs = new Set(); // Remove duplicates
    let poll_index = list.flatMap(module => module.polls).length * 16;
    for (const module of list) { // Process configuration to form complete data
        assert.equal(typeof module.module?.block_no, 'number', new SyntaxError(`${CPU.name}:SC:module(${module.comment}) 模块地址有误!`));
        module.name ??= `polls_${module.module.block_no}`;
        for (const poll of module.polls) {
            if (poll.extra_code?.value === 'FB') {
                const DB_list = poll.send_DB === poll.recv_DB ? [poll.send_DB] : [poll.send_DB, poll.recv_DB];
                const extra_code = DB_list.flatMap(DB => {
                    if (DB.type_name !== 'FB') return [];
                    if (DBs.has(DB)) {
                        elog(new SyntaxError(`DB "${DB.type}"."${DB.name}" is called repeatedly! 重复调用！`));
                    }
                    DBs.add(DB);
                    const comment = DB.comment ? ` // ${DB.comment}` : '';
                    return `"${DB.type}"."${DB.name}"();${comment}`;
                }).join('\n');
                poll.extra_code = extra_code === '' ? null : new STRING(extra_code);
            }
            // When there is an external send block then skip the following
            if (poll.extra_send_DB) continue;

            poll.send_start = new PINT(poll_index);
            if (poll.send_data?.length) { // poll has send_data
                poll.send_length = poll.send_data.length;
            } else { // poll has unit_ID, func_code, address and data
                poll.send_data = null;
                if (poll.extra_data_length) {
                    poll.send_length = 9 + poll.extra_data_length;
                } else {
                    poll.send_length = 8;
                }
            }
            poll_index += poll.send_length + 2 + poll.send_length % 2;
        }
    }
}

export function gen({ document, invoke_code, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { LOOP_NAME, invoke_code, CP340_NAME, CP341_NAME, POLLS_NAME };
    const template = 'SC.template';
    return [{ distance, output_dir, tags, template }];
}

export function gen_copy_list({ document, options }) {
    const copy_list = [`${CRC}.awl`];
    if (options.has_CP340) copy_list.push(`${CP340_NAME}.scl`);
    if (options.has_CP341) copy_list.push(`${CP341_NAME}.scl`);
    const IE = 'utf8';
    return copy_list.map(filename => {
        const source = posix.join('CP_Poll', filename);
        const input_dir = context.module_path;
        const distance = posix.join(document.CPU.output_dir, filename);
        const output_dir = context.work_path;
        return { source, input_dir, distance, output_dir, IE };
    });
}

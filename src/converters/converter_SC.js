/**
 * serial processing
 * Provide 3 functions according to 3 stages: get_symbols_CP build_CP gen_CP
 * @file SC
 */

import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { isSeq } from 'yaml';
import { context, fixed_hex, elog } from '../util.js';
import { BOOL, STRING, PINT, ensure_value, nullable_value } from '../s7data.js';
import { make_s7_expression } from '../symbols.js';

export const platforms = ['step7']; // platforms supported by this feature
export const CP340_NAME = 'CP340_Poll';
export const CP341_NAME = 'CP341_Poll';
export const LOOP_NAME = 'SC_Loop';
export const CRC = 'CRC16';
export const POLLS_NAME = 'SC_polls_DB';
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
        });

        const customREQ = node.get('customREQ');
        if (customREQ) make_s7_expression(
            customREQ,
            {
                document,
                force: { type: 'BOOL' },
                s7_expr_desc: `SC ${comment} customREQ`,
            },
        ).then(symbol => {
            module.customREQ = symbol;
        });

        const polls = node.get('polls');
        assert(isSeq(polls), SyntaxError(`配置项"polls"必须为数组且个数大于0!`));
        module.polls = polls.items.map(item => {
            const poll = {
                comment: ensure_value(STRING, item.get('comment') ?? ''),
                send_data: nullable_value(STRING, item.get('send_data')),
                recv_start: ensure_value(PINT, item.get('recv_start')),
                uninvoke: ensure_value(BOOL, item.get('uninvoke') ?? false),
            }
            poll.is_modbus = !poll.send_data;
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
            const send_DB = item.get('send_DB');
            poll.extra_send_DB = !!send_DB;
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

            if (poll.extra_send_DB) {
                // When there is an external send block, send_start and send_length must be present
                poll.send_start = ensure_value(PINT, item.get('send_start'));
                poll.send_length = ensure_value(PINT, item.get('send_length'));
            } else if (!poll.send_data) {
                // When there is no external send block but send_data, unit_ID, func_code, started_addr and data must be present
                poll.unit_ID = ensure_value(PINT, item.get('unit_ID'));
                poll.func_code = ensure_value(PINT, item.get('func_code'));
                poll.started_addr = nullable_value(PINT, item.get('started_addr')) ?? ensure_value(PINT, item.get('address'));
                // TODO:The correct information for the error in the previous sentence should be:
                // new SyntaxError(`配置项 address 或 started_addr 必须有一个!`)
                poll.data = nullable_value(PINT, item.get('data')) ?? ensure_value(PINT, item.get('length'));
                // TODO:The correct information for the error in the previous sentence should be:
                // new SyntaxError(`配置项 data 或 length 必须有一个!`)
            }
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
    const CPU = SC.document.CPU;
    const DBs = new Set(); // Remove duplicates
    const list = SC.list;
    const polls = list.flatMap(module => module.polls);
    polls.forEach((poll, index) => { poll.index = index; })
    let sendDBB = polls.length * 16;
    for (const module of list) { // Process configuration to form complete data
        assert.equal(typeof module.module?.block_no, 'number', new SyntaxError(`${CPU.name}:SC:module(${module.comment}) 模块地址有误!`));
        module.name ??= `polls_${module.module.block_no}`;
        for (const poll of module.polls) {
            if (poll.extra_send_DB) assert(
                poll.send_start && poll.send_length,
                new SyntaxError(`指定发送块 send_DB:${module.name}/poll_${poll.index} 时，必须同时设置 send_start 和 send_length`)
            );
            if (poll.send_data) {
                const send_data = poll.send_data.value.trim();
                // send_data must be a space-separated hex string
                const send_data_error = new SyntaxError(`"send_data:${send_data}" —— send_data 必须是一个由空格分隔的16进制字符串`);
                assert(/^[0-9a-f]{2}( +[0-9a-f]{2})+$/i.test(send_data), send_data_error);
                const data_stream = send_data.split(/ +/);
                poll.send_data = data_stream.map(byte => fixed_hex(byte, 2));
                poll.send_length = data_stream.length;
            } else if (poll.unit_ID && poll.is_modbus) {
                poll.send_length = 8;
            } else if (!poll.extra_send_DB) { // poll configuration wrong!
                elog(new SyntaxError(`发送数据在轮询DB中时，poll.unit_ID 和 poll.send_data 必须有其中一个!\nunit_ID:${poll.unit_ID}\tsend_data:${poll.send_data}`));
            }
            if (!poll.extra_send_DB) {
                poll.send_start = sendDBB;
                sendDBB += poll.send_length + poll.send_length % 2;
            }
            poll.send_DB.uninvoke ??= poll.send_DB.type_name !== 'FB' || poll.uninvoke.value;
            poll.recv_DB.uninvoke ??= poll.recv_DB.type_name !== 'FB' || poll.uninvoke.value;
            DBs.add(poll.send_DB).add(poll.recv_DB);
        }
    }
    SC.invoke_code = [...DBs].map(DB => {
        const comment = DB.comment ? ` // ${DB.comment}` : '';
        return DB.uninvoke ? `// "${DB.name}" ${DB.comment ?? ''}` : `"${DB.type}"."${DB.name}"();${comment}`;
    }).join('\n');
}

export function gen({ document, invoke_code, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { LOOP_NAME, invoke_code, CP340_NAME, CP341_NAME, POLLS_NAME };
    const template = posix.join(context.module_path, 'src/converters/SC.template');
    return [{ distance, output_dir, tags, template }];
}

export function gen_copy_list({ document, options }) {
    const copy_list = [];
    function push_copy_item(filename, IE = 'utf8') {
        const source = posix.join('CP_Poll', filename);
        const input_dir = context.module_path;
        const distance = posix.join(document.CPU.output_dir, filename);
        const output_dir = context.work_path;
        copy_list.push({ source, input_dir, distance, output_dir, IE });
    }
    if (options.has_CP340) push_copy_item(`${CP340_NAME}.scl`);
    if (options.has_CP341) push_copy_item(`${CP341_NAME}.scl`);
    push_copy_item(`${CRC}.awl`);
    return copy_list;
}

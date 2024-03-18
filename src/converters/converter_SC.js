/**
 * 串行处理
 * 依照3阶段提供3个函数， get_symbols_CP build_CP gen_CP
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
    name = name.toUpperCase();
    return name === feature || name === 'MB';
}

/**
 * @typedef {object} S7Item
 * @property {Object} CPU
 * @property {Array} list
 * @property {Object} Options
 * @property {Array|string} includes
 */

/**
 * 第一遍扫描 提取符号
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
        ).then(
            symbol => module.module = symbol
        );

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
        ).then(
            symbol => module.DB = symbol
        );

        const customREQ = node.get('customREQ');
        if (customREQ) make_s7_expression(
            customREQ,
            {
                document,
                force: { type: 'BOOL' },
                s7_expr_desc: `SC ${comment} customREQ`,
            },
        ).then(
            symbol => module.customREQ = symbol
        );

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
            ).then(
                symbol => poll.recv_DB = symbol
            );
            const send_DB = item.get('send_DB');
            poll.extra_send_DB = !!send_DB;
            make_s7_expression(
                send_DB ?? POLLS_NAME,
                {
                    document,
                    disallow_s7express: true,
                    default: { comment },
                },
            ).then(
                symbol => poll.send_DB = symbol
            );

            if (poll.extra_send_DB) {
                // 有外部发送块时，必须有 send_start 和 send_length
                poll.send_start = ensure_value(PINT, item.get('send_start'));
                poll.send_length = ensure_value(PINT, item.get('send_length'));
            } else if (!poll.send_data) {
                // 无外部发送块但有send_data时，必须有 deivce_ID、function、started_addr 和 data
                poll.deivce_ID = ensure_value(PINT, item.get('deivce_ID'));
                poll.function = ensure_value(PINT, item.get('function'));
                poll.started_addr = nullable_value(PINT, item.get('started_addr')) ?? ensure_value(PINT, item.get('address'));
                // TODO:上一句出错的正确信息应当是 new SyntaxError(`配置项 address 或 started_addr 必须有一个!`)
                poll.data = nullable_value(PINT, item.get('data')) ?? ensure_value(PINT, item.get('length'));
                // TODO:上一句出错的正确信息应当是 new SyntaxError(`配置项 data 或 length 必须有一个!`)
            }
            return poll;
        });
        return module;
    })
}

/**
 * 第二遍扫描 建立数据并查错
 * @date 2021-12-07
 * @param {S7Item} SC
 * @returns {void}
 */
export function build_list(SC) {
    const CPU = SC.document.CPU;
    const DBs = new Set(); // 去重
    const list = SC.list;
    const polls = list.map(module => module.polls).flat();
    polls.forEach((poll, index) => poll.index = index);
    let sendDBB = polls.length * 16;
    list.forEach(module => { // 处理配置，形成完整数据
        assert.equal(typeof module.module?.block_no, 'number', new SyntaxError(`${CPU.name}:SC:module(${module.comment}) 模块地址有误!`));
        module.name ??= "polls_" + module.module.block_no;
        module.polls.forEach(poll => {
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
            } else if (poll.deivce_ID && poll.is_modbus) {
                poll.send_length = 8;
            } else if (!poll.extra_send_DB) { // poll configuration wrong!
                elog(new SyntaxError(`发送数据在轮询DB中时，poll.deivce_ID 和 poll.send_data 必须有其中一个!\ndeivce_ID:${poll.deivce_ID}\tsend_data:${poll.send_data}`));
            }
            if (!poll.extra_send_DB) {
                poll.send_start = sendDBB;
                sendDBB += poll.send_length + poll.send_length % 2;
            }
            [poll.send_DB, poll.recv_DB].forEach(DB => {
                // 用 ??= 确保共用块只遵循第一次的设置
                DB.uninvoke ??= DB.type_name !== 'FB' || poll.uninvoke.value;
            });
            DBs.add(poll.send_DB).add(poll.recv_DB);
        });
    });
    SC.invoke_code = [...DBs].map(DB => {
        const comment = DB.comment ? ` // ${DB.comment}` : '';
        return DB.uninvoke ? `// "${DB.name}" ${DB.comment ?? ''}` : `"${DB.type}"."${DB.name}"();${comment}`;
    }).join('\n');
}

export function gen({ document, invoke_code, options = {} }) {
    const { CPU } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME + '.scl' } = options;
    const path = `${output_dir}/${output_file}`;
    const tags = { LOOP_NAME, invoke_code, CP340_NAME, CP341_NAME, POLLS_NAME };
    const template = 'SC.template';
    return [{ path, tags, template }];
}

export function gen_copy_list(item) {
    const copy_list = [];
    function push_copy_pair(filename, encoding) {
        encoding ??= 'utf8'
        const src = {
            filename: posix.join(context.module_path, 'CP_Poll', filename),
            encoding,
        };
        const dst = posix.join(context.work_path, item.document.CPU.output_dir, filename);
        copy_list.push({ src, dst });
    }
    if (item.options.has_CP340) push_copy_pair(`${CP340_NAME}.scl`);
    if (item.options.has_CP341) push_copy_pair(`${CP341_NAME}.scl`);
    push_copy_pair(`${CRC}.awl`, 'gbk');
    return copy_list;
}

import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { isSeq } from 'yaml';
import { make_s7_expression } from '../symbols.js';
import {
    BOOL, PINT, STRING, TIME,
    nullable_value, ensure_value,
    IntHashList
} from '../s7data.js';
import { context, fixed_hex, elog } from '../util.js';

export const platforms = ['step7']; // platforms supported by this feature
export const NAME = 'MT_Poll';
export const LOOP_NAME = 'MT_Loop';
export const POLLS_NAME = 'MT_polls_DB';
export const TRY_TIMES = 10;
const feature = 'modbusTCP';

const DEFAULT_DEVICE_ID = "B#16#02"; // Default device number
const device_id = { // Just fill in the device model
    "IM151-8_PN/DP": "B#16#01",
    "CPU31x-2_PN/DP": "B#16#02",
    "CPU314C-2_PN/DP": "B#16#02",
    "IM154-8_PN/DP": "B#16#02",
    "CPU315T-3_PN/DP": "B#16#03",
    "CPU317T-3_PN/DP": "B#16#03",
    "CPU317TF-3_PN/DP": "B#16#03",
    "CPU412-2_PN": "B#16#05",
    "CPU414-3_PN/DP": "B#16#05",
    "CPU416-3_PN/DP": "B#16#05",
}
const device_X_id = { // You may need to fill in the slot number
    //['', 'X2', 'X4']
    "CPU317-2_PN/DP": "B#16#02",
    "CPU317-2_PN/DP_X2": "B#16#02",
    "CPU317-2_PN/DP_X4": "B#16#04",
    //['', 'X3', 'X4']
    "CPU319-3_PN/DP": "B#16#03",
    "CPU319-3_PN/DP_X3": "B#16#03",
    "CPU319-3_PN/DP_X4": "B#16#04",
}
const device_R_X_id = { // You may need to fill in the slot number and rack number
    // ['', 'R0', 'R1'] × ['', 'X5']
    // 412-5H
    "CPU412-5H_PN/DP": "B#16#05",
    "CPU412-5H_PN/DP_X5": "B#16#05",
    "CPU412-5H_PN/DP_R0": "B#16#05",
    "CPU412-5H_PN/DP_R0_X5": "B#16#05",
    "CPU412-5H_PN/DP_R1": "B#16#15",
    "CPU412-5H_PN/DP_R1_X5": "B#16#15",
    // 414-5H
    "CPU414-5H_PN/DP": "B#16#05",
    "CPU414-5H_PN/DP_X5": "B#16#05",
    "CPU414-5H_PN/DP_R0": "B#16#05",
    "CPU414-5H_PN/DP_R0_X5": "B#16#05",
    "CPU414-5H_PN/DP_R1": "B#16#15",
    "CPU414-5H_PN/DP_R1_X5": "B#16#15",
    // 416-5H
    "CPU416-5H_PN/DP": "B#16#05",
    "CPU416-5H_PN/DP_X5": "B#16#05",
    "CPU416-5H_PN/DP_R0": "B#16#05",
    "CPU416-5H_PN/DP_R0_X5": "B#16#05",
    "CPU416-5H_PN/DP_R1": "B#16#15",
    "CPU416-5H_PN/DP_R1_X5": "B#16#15",
    // 417-5H
    "CPU417-5H_PN/DP": "B#16#05",
    "CPU417-5H_PN/DP_X5": "B#16#05",
    "CPU417-5H_PN/DP_R0": "B#16#05",
    "CPU417-5H_PN/DP_R0_X5": "B#16#05",
    "CPU417-5H_PN/DP_R1": "B#16#15",
    "CPU417-5H_PN/DP_R1_X5": "B#16#15",
    // 410-5H  ['', 'R0', 'R1'] × ['', 'X5', 'X8']
    "CPU410-5H": "B#16#05",
    "CPU410-5H_X5": "B#16#05",
    "CPU410-5H_X8": "B#16#08",
    "CPU410-5H_R0": "B#16#05",
    "CPU410-5H_R0_X5": "B#16#05",
    "CPU410-5H_R0_X8": "B#16#08",
    "CPU410-5H_R1": "B#16#15",
    "CPU410-5H_R1_X5": "B#16#15",
    "CPU410-5H_R1_X8": "B#16#18",
}

export function is_feature(name) {
    const f_name = name.toLowerCase();
    return f_name === 'mt' || f_name === 'modbustcp';
}

function get_device_id(device, R, X) {
    let id = device_id[device];
    if (id) return id; // device is valid
    const device_paras = [device];
    if (R) {
        device_paras.push(R);
    }
    if (X) {
        id = device_X_id[`${device}_${X}`];
        if (id) return id; // device_X is valid
        device_paras.push(X);
    }
    id = device_R_X_id[device_paras.join('_')]
    if (id) return id; // device_R_X is valid
    return null; // No corresponding device number
}

/**
 * First scan to extract symbols
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    const CPU = document.CPU;
    // CPU.device It must be scanned at second time to be effective.
    area.list = area.list.map(node => {
        const conn = {
            node,
            ID: nullable_value(PINT, node.get('ID')),
            name: nullable_value(STRING, node.get('name') ?? node.get('polls_name')),
            comment: new STRING(node.get('comment') ?? '')
        };
        const comment = conn.comment.value;
        const name = conn.name?.value;
        const DB = node.get('DB');
        assert(DB, new SyntaxError(
            `${CPU.name}:MT:conn(${name ?? conn.ID}) DB is not defined correctly! 没有正确定义DB!`
        ));
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(symbol => {
            conn.DB = symbol;
        });

        // host IP
        let host = node.get('host');
        host = isSeq(host) ? host.items.join('.') : ensure_value(STRING, host).value;
        assert(
            /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host),
            new SyntaxError(`配置项"host: ${host}"有误，必须提供IP地址，可以是数组形式!`)
        );
        conn.host = host;
        conn.port = nullable_value(PINT, node.get('port'));
        conn.IP = host.split('.').map(part => {
            const ip = ensure_value(PINT, part);
            assert(ip.value < 256, new SyntaxError(`配置项"host: ${host}"的IP地址越界!`));
            return ip;
        });
        const R = nullable_value(PINT, node.get('rack'));
        const X = nullable_value(PINT, node.get('XSlot'));
        conn.R = R ? `R${R}` : '';
        conn.X = X ? `X${X}` : '';
        conn.$interval_time = nullable_value(TIME, node.get('$interval_time'));
        const interval_time = node.get('interval_time');
        make_s7_expression(
            interval_time,
            {
                document,
                force: { type: 'DINT' },
                default: { comment: `interval time of ${comment}` },
                s7_expr_desc: `MT ${comment} conn.interval_time`,
            },
        ).then(symbol => {
            conn.interval_time = symbol;
        });

        const polls = node.get('polls');
        assert(isSeq(polls), SyntaxError(`配置项"polls"必须为数组且个数大于0!`));
        conn.polls = polls.items.map(item => {
            const poll = {
                enable: nullable_value(BOOL, item.get('enable')),
                custom_trigger: nullable_value(BOOL, item.get('custom_trigger')),
                comment: ensure_value(STRING, item.get('comment') ?? ''),
                recv_start: ensure_value(PINT, item.get('recv_start'),
                    'recv_start must be gaven and be a positive integer!\n' +
                    '配置项 recv_start 必须提供并且是一个正整数!'
                ),
                extra_code: nullable_value(STRING, item.get('extra_code')),
                try_times: ensure_value(PINT, item.get('try_times') ?? TRY_TIMES),
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
                // When there is an external send block, send_start must be present
                poll.send_start = ensure_value(PINT, item.get('send_start'),
                    'when an external send block is present, send_start must be gaven and be a positive integer!\n' +
                    '当指定外部发送块时，配置项 send_start 必须提供并且是一个正整数!'
                );
            } else {
                // When there is no external send block
                // the unit_ID, func_code, started_addr and data must be present
                poll.unit_ID = ensure_value(PINT, item.get('unit_ID'),
                    'Either send_DB or unit_ID must be present! and unit_ID must be a positive integer!\n' +
                    '配置项 send_DB 或 unit_ID 必须有一个! unit_ID 必须是一个正整数!'
                );
                poll.func_code = ensure_value(PINT, item.get('func_code'),
                    'when send_DB is present, func_code must be gaven and be a positive integer!\n' +
                    '当指定 send_DB 时，配置项 func_code 必须提供并且是一个正整数!'
                );
                poll.started_addr = ensure_value(PINT, item.get('started_addr') ?? item.get('address'),
                    'The configuration item address or started_addr must have one!配置项 address 或 started_addr 必须有一个!'
                );
                poll.data = ensure_value(PINT, item.get('data') ?? item.get('length'),
                    'The configuration item data or length must have one!配置项 data 或 length 必须有一个!'
                );
                const func_code = poll.func_code.value;
                if (func_code === 15 || func_code === 16) {
                    poll.extra_data = ensure_value(STRING, item.get('extra_data'),
                        'When the function code is 15 or 16, the extra_data configuration item must be present!',
                    ).value;
                }
            }
            return poll;
        })
        return conn;
    });
}

export function build_list(MT) {
    const { document, list, options } = MT
    const CPU = document.CPU;
    const DBs = new Set(); // Remove duplicates
    let poll_index = list.flatMap(conn => conn.polls).length * 16;
    for (const conn of list) { // Process configuration to form complete data
        const {
            conn_ID_list,
            conn_host_list,
        } = CPU;

        conn.device ??= CPU.device;
        const {
            ID,
            local_device_id = get_device_id(conn.device, conn.R, conn.X), // Already an SCL literal
            host,
            // interval_time, // The SCL program is responsible for the default interval length
        } = conn;
        const port = conn.port.value;

        // The specified device does not have a corresponding communication device number.
        if (local_device_id === null && conn.device) elog(new SyntaxError(`指定的通信设备号"${conn.device} rack${conn.rack} xslot${conn.XSlot}"不存在！`));
        // If device is not specified, the default device number is used.
        conn.local_device_id = local_device_id ?? DEFAULT_DEVICE_ID;

        // port_list
        conn_host_list[host] ??= new IntHashList(502); // By default, a host starts from port 502
        const port_list = conn_host_list[host];
        port_list.push(port);

        conn.ID = fixed_hex(conn_ID_list.push(ID), 4);
        conn.DB.name ??= `conn_MT${ID}`;
        conn.IP1 = fixed_hex(conn.IP[0], 2);
        conn.IP2 = fixed_hex(conn.IP[1], 2);
        conn.IP3 = fixed_hex(conn.IP[2], 2);
        conn.IP4 = fixed_hex(conn.IP[3], 2);
        conn.port1 = fixed_hex((port >>> 8), 2);
        conn.port2 = fixed_hex((port & 0xff), 2);
        conn.name ??= new STRING(`polls_${conn.ID}`);
        for (const poll of conn.polls) {
            if (!poll.extra_send_DB) {
                poll.send_start = new PINT(poll_index);
                // When there is an external send block
                poll.unit_ID = fixed_hex(poll.unit_ID, 2);
                poll.func_code = fixed_hex(poll.func_code, 2);
                poll.address = fixed_hex(poll.address ?? poll.started_addr, 4);
                poll.data = fixed_hex(poll.data ?? poll.length, 4);
                poll.MBAP_protocol = '00';
                const extra_data = poll.extra_data;
                if (extra_data) {
                    poll.extra_data = extra_data.trim().split(/ +/).map(byte => fixed_hex(byte, 2));
                    poll.extra_data_length = poll.extra_data.length;
                    poll.MBAP_length = 7 + poll.extra_data_length;
                } else {
                    poll.extra_data = [];
                    poll.extra_data_length = 0;
                    poll.MBAP_length = 6;
                }
                // the packet struct starts at an even address.
                poll_index += poll.MBAP_length + 6 + poll.MBAP_length % 2;
            }
            if (poll.extra_code) {
                poll.recv_DB.invoke = false;
            } else {
                // Use ??= to ensure that the shared block only respects the first setting
                poll.recv_DB.invoke ??= poll.recv_DB.type_name === 'FB';
            }
            DBs.add(poll.recv_DB);
        }
    }
    options.invoke_code = [...DBs].flatMap(DB => {
        const comment = DB.comment ? ` // ${DB.comment}` : '';
        return DB.invoke ? `"${DB.type}"."${DB.name}"();${comment}` : [];
    }).join('\n');
}

export function gen({ document, options }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl`, invoke_code } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME, invoke_code, POLLS_NAME };
    const template = 'MT.template';
    return [{ distance, output_dir, tags, template }];
}

export function gen_copy_list({ document }) {
    const source = posix.join(NAME, `${NAME}.scl`);
    const input_dir = context.module_path;
    const distance = posix.join(document.CPU.output_dir, `${NAME}.scl`);
    const output_dir = context.work_path;
    const IE = 'utf8';
    return [{ source, input_dir, distance, output_dir, IE }];
}

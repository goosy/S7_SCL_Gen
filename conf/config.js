export const MT_connections = [
    { // connection 1
        ID: 16,  // 十进制，不可重复。可省略，程序会自动生成一个，第一个为1，其余为上一个地址加1。
        name: "conn_KX", // 连接名称，建议填写有可读性。可省略，默认为 "conn_MT"+ID，本例为"conn_MT16"
        // DB_NO: 891, // 连接DB绝对地址，这里表示第一个连接块为 DB891，省略时程序会从DB891向后自动填
        host: [192, 168, 27, 61], // modbusTCP 对方IP 必填
        port: 502, // modbusTCP 对方端口，当省略时，对每个连接，默认从502开始。
        local_device_id: 2, // 2:300CPU 5:400CPU左X5 15:400CPU右X5 8:400CPU左X8 18:400CPU右X8
        // interval_time: 200, // 可省略，默认为200ms
        comment: '192.168.27.61:502 垦西交油点 1# 2# ', // 本连接的注释
        poll_name: 'poll_KX', // 查询名称，建议填写有可读性。可省略，默认为 "poll_"+连续序号
        polls: [ // 该连接下的轮询定义，至少要有一个查询
            { // 查询1
                deivce_ID: 1, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "FlowKX01", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 801, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".FlowKX01();', // 正常省略，对接收块数据的额外处理
                },
                comment: '垦西1#流量计', // 本查询的注释
            }, { // 查询2
                deivce_ID: 2, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "FlowKX02", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 802, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".FlowKX02();', // 正常省略，对接收块数据的额外处理
                },
                comment: '垦西2#流量计', // 本查询的注释
            },
        ],
    }, { // connection 2
        // ID: 16,  // 十进制，不可重复。可省略，程序会自动生成一个，第一个为1，其余为上一个地址加1。
        name: "conn_GYD", // 连接名称，建议填写有可读性。可省略，默认为 "conn_MT"+ID，本例为"conn_MT16"
        // DB_NO: 891, // 连接DB绝对地址，这里表示第一个连接块为 DB891，省略时程序会从DB891向后自动填
        host: [192, 168, 27, 62], // modbusTCP 对方IP 必填
        port: 5001, // modbusTCP 对方端口，当省略时，对每个连接，默认从502开始。
        local_device_id: 2, // 2:300CPU 5:400CPU左X5 15:400CPU右X5 8:400CPU左X8 18:400CPU右X8
        // interval_time: 200, // 可省略，默认为200ms
        comment: '192.168.27.62:5001 孤永东 1# 2# 3#', // 本连接的注释
        poll_name: 'poll_GYD', // 查询名称，建议填写有可读性。可省略，默认为 "poll_"+连续序号
        polls: [ // 该连接下的轮询定义，至少要有一个查询
            { // 查询1
                deivce_ID: 31, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow31", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 831, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow31();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤永东1#流量计', // 本查询的注释
            }, { // 查询2
                deivce_ID: 32, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow32", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 832, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow32();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤永东2#流量计', // 本查询的注释
            }, { // 查询3
                deivce_ID: 33, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow33", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 833, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow33();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤永东3#流量计', // 本查询的注释
            },
        ],
    }, { // connection 3
        // ID: 16,  // 十进制，不可重复。可省略，程序会自动生成一个，第一个为1，其余为上一个地址加1。
        name: "conn_GLD", // 连接名称，建议填写有可读性。可省略，默认为 "conn_MT"+ID，本例为"conn_MT16"
        // DB_NO: 891, // 连接DB绝对地址，这里表示第一个连接块为 DB891，省略时程序会从DB891向后自动填
        host: [192, 168, 27, 62], // modbusTCP 对方IP 必填
        port: 5002, // modbusTCP 对方端口，当省略时，对每个连接，默认从502开始。
        local_device_id: 2, // 2:300CPU 5:400CPU左X5 15:400CPU右X5 8:400CPU左X8 18:400CPU右X8
        // interval_time: 200, // 可省略，默认为200ms
        comment: '192.168.27.62:5002 孤罗东 1# 2# 3#', // 本连接的注释
        poll_name: 'poll_GLD', // 查询名称，建议填写有可读性。可省略，默认为 "poll_"+连续序号
        polls: [ // 该连接下的轮询定义，至少要有一个查询
            { // 查询1
                deivce_ID: 34, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow34", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 834, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow34();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤罗东1#流量计', // 本查询的注释
            }, { // 查询2
                deivce_ID: 35, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow35", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 835, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow35();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤罗东2#流量计', // 本查询的注释
            }, { // 查询3
                deivce_ID: 36, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow36", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 836, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow36();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤罗东3#流量计', // 本查询的注释
            },
        ],
    }, { // connection 4
        // ID: 16,  // 十进制，不可重复。可省略，程序会自动生成一个，第一个为1，其余为上一个地址加1。
        name: "conn_GDong", // 连接名称，建议填写有可读性。可省略，默认为 "conn_MT"+ID，本例为"conn_MT16"
        // DB_NO: 891, // 连接DB绝对地址，这里表示第一个连接块为 DB891，省略时程序会从DB891向后自动填
        host: [192, 168, 27, 62], // modbusTCP 对方IP 必填
        port: 5003, // modbusTCP 对方端口，当省略时，对每个连接，默认从502开始。
        local_device_id: 2, // 2:300CPU 5:400CPU左X5 15:400CPU右X5 8:400CPU左X8 18:400CPU右X8
        // interval_time: 200, // 可省略，默认为200ms
        comment: '192.168.27.62:5003 孤东来油 1# 2# 3#', // 本连接的注释
        poll_name: 'poll_GDong', // 查询名称，建议填写有可读性。可省略，默认为 "poll_"+连续序号
        polls: [ // 该连接下的轮询定义，至少要有一个查询
            { // 查询1
                deivce_ID: 86, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow86", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 886, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow86();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤罗东1#流量计', // 本查询的注释
            }, { // 查询2
                deivce_ID: 87, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow87", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 887, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow87();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤罗东2#流量计', // 本查询的注释
            }, { // 查询3
                deivce_ID: 88, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow88", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 888, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow88();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤罗东3#流量计', // 本查询的注释
            },
        ],
    }, { // connection 5
        // ID: 16,  // 十进制，不可重复。可省略，程序会自动生成一个，第一个为1，其余为上一个地址加1。
        name: "conn_GDao", // 连接名称，建议填写有可读性。可省略，默认为 "conn_MT"+ID，本例为"conn_MT16"
        // DB_NO: 891, // 连接DB绝对地址，这里表示第一个连接块为 DB891，省略时程序会从DB891向后自动填
        host: [192, 168, 27, 63], // modbusTCP 对方IP 必填
        port: 6001, // modbusTCP 对方端口，当省略时，对每个连接，默认从502开始。
        local_device_id: 2, // 2:300CPU 5:400CPU左X5 15:400CPU右X5 8:400CPU左X8 18:400CPU右X8
        // interval_time: 200, // 可省略，默认为200ms
        comment: '192.168.27.61:6001 孤岛来油 2# 3# ', // 本连接的注释
        poll_name: 'poll_GDao', // 查询名称，建议填写有可读性。可省略，默认为 "poll_"+连续序号
        polls: [ // 该连接下的轮询定义，至少要有一个查询
            { // 查询1
                deivce_ID: 77, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow77", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 877, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow77();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤岛来油1#流量计', // 本查询的注释
            }, { // 查询2
                deivce_ID: 78, // 设备号，即RTU从站地址
                function: 4, // modbus 功能号
                started_addr: 0, // 查询起始地址
                length: 28, // 查询长度
                recv_DB: { // 接收DB
                    name: "Flow78", // 名称，省略则为绝对地址，比如 DB801
                    DB_NO: 878, // 绝对地址，必填
                    start: 0, // 接收开始位置
                    type: ['FB', 801], // 正常省略，接收块类型和地址一致，或通过某个FB指定结构
                    additional_code: '"JS_flow".Flow78();', // 正常省略，对接收块数据的额外处理
                },
                comment: '孤岛来油2#流量计', // 本查询的注释
            },
        ],
    }
];

export const addition = { // 以下非必需，可以全部注释掉。
    // 额外的符号表
    symbols: ['126,JS_flow                 FB    801   FB    801                                                                                 '],
    // 额外的 modbusTCP 主FB块设定
    MB_TCP_Poll: { FB_NO: 343, name: 'MB_TCP_Poll' },
    // 额外的循环调用设定
    MT_Loop: { FC_NO: 343, name: 'MT_Loop' },
    // 额外的轮询块设定
    Poll_DB: { DB_NO: 800, name: 'Poll_DB' },
}

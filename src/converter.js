// ./src/converters 目录下的JS文件为转换器
// 每个转换器必须实现
//   function if_type_<type>        判断是否为当前转换类型
//   function gen_<type>            生成转换列表
// 每个转换器可选实现
//   Array <type>_BUILDIN           该转换类型的内置符号列表
//   function parse_symbols_<type>  提取符号
//   function build_<type>          构建转换数据
//   function gen_<type>_copy_list  生成复制列表
// 转换器文件定义了目前支持的转换类型
export const supported_types = ['AI', 'alarm', 'CPU', 'motor', 'MT', 'PI', 'SC', 'valve'];

// 引入所有的转换器
import * as AI_converter from './converters/AI.js';
import * as alarm_converter from './converters/alarm.js';
import * as CPU_converter from './converters/CPU.js';
import * as motor_converter from './converters/motor.js';
import * as MT_converter from './converters/MT.js';
import * as PI_converter from './converters/PI.js';
import * as SC_converter from './converters/SC.js';
import * as valve_converter from './converters/valve.js';

export const converter = { 
    ...AI_converter,
    ...alarm_converter,
    ...CPU_converter,
    ...motor_converter,
    ...MT_converter,
    ...PI_converter,
    ...SC_converter,
    ...valve_converter,
}

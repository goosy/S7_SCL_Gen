import { posix } from 'node:path';
import { make_s7_expression, add_symbol, is_common_type, is_assignable } from '../symbols.js';
import { BOOL, INT, PINT, DINT, PDINT, REAL, STRING, ensure_value, nullable_value } from '../s7data.js';
import { isString } from '../gcl.js';
import { isMap, isSeq } from 'yaml';
import { context, elog } from '../util.js';

export const platforms = ['step7', 'portal']; // platforms supported by this feature
export const LOOP_NAME = 'Interlock_Loop';
const feature = 'interlock';

export function is_feature(name) {
    const f_name = name.toLowerCase();
    return f_name === feature || f_name === 'il';
}

function create_fields() {
    const s7_m_c = true;
    let index = 0;
    // S7 identifiers are case-insensitive, so names are compared in lower case
    const lower_names = new Set(['enable']);
    const fields = {
        'enable': { name: 'enable', s7_m_c, init: 'TRUE', comment: '允许报警或连锁' },
        push(item) {
            if (item.name == null) {
                // Skip the numbers whose name or edge field name is already taken
                do {
                    item.name = `b_${++index}`;
                } while (lower_names.has(item.name) || lower_names.has(`${item.name}_fo`));
            }
            const name = String(item.name);
            const lower_name = name.toLowerCase();
            if (lower_names.has(lower_name)) elog(new SyntaxError(`interlock 项属性 name:${name} 重复定义或已保留!请改名`));
            lower_names.add(lower_name);
            this[name] = item;
        }
    };
    Object.defineProperty(fields, 'push', {
        enumerable: false,
        configurable: false,
        writable: false
    });
    return fields;
}

// The special variable `inputs`, not part of a longer identifier, a quoted name or a member access
const INPUTS_REGEX = /(?<![\w."])inputs(?![\w"])/gi;
const TRIGGER_TYPES = ['rising', 'falling', 'change', 'on', 'off'];

// SCL literal of an initial value, by the common type of the data item
const INIT_FORMATTERS = {
    BOOL: value => new BOOL(value).toString(),
    BYTE: value => {
        const byte = new PINT(value);
        if (byte.value > 255) throw new RangeError(`the value "${value}" must be within 8 binary numbers. 值范围必须在8位二进制数以内`);
        return byte.byteHEX;
    },
    WORD: value => new PINT(value).wordHEX,
    DWORD: value => new PDINT(value).dwordHEX,
    INT: value => new INT(value).toString(),
    DINT: value => new DINT(value).toString(),
    REAL: value => new REAL(value).toString(),
};

// Keys of a group; at DB level they form the shorthand single group
const GROUP_KEYS = ['input', 'reset', 'output', 'extra_code'];

/**
 * Resolve the DB name of a list item. A symbol definition adds the symbol.
 * @param {Document} document
 * @param {string|Array|node} name_raw
 * @returns {string}
 */
function get_DB_name(document, name_raw) {
    let name = name_raw;
    if (Array.isArray(name_raw) || isSeq(name_raw)) {
        // If it is a symbol definition, create a new symbol
        name = add_symbol(document, name_raw).name;
    }
    if (isString(name)) name = name.value;
    if (typeof name !== 'string') elog(Error(`Interlock DB"${name}" 输入错误！`));
    return name;
}

/**
 * Parse one list item into a DB with its data and interlock groups
 * @param {Document} document
 * @param {node} node the YAML map of the list item
 * @param {Set<string>} DB_names names of the DBs already parsed
 * @returns {DB}
 */
function parse_DB(document, node, DB_names) {
    const _DB = node.get('DB');
    if (!_DB) elog(new SyntaxError("interlock转换必须有DB块!"));
    const DB_name = get_DB_name(document, _DB);
    if (DB_names.has(DB_name)) elog(new SyntaxError(`interlock 的 DB "${DB_name}" 重复！多组联锁共用一个 DB 时，请用 groups 写在同一个 list 项中`));
    DB_names.add(DB_name);

    const fields = create_fields();
    const data_dict = {};
    const DB = {
        name: DB_name,
        comment: nullable_value(STRING, node.get('comment'))?.value,
        fields, data_dict,
        interlocks: [],
        edges: [],
    };
    make_s7_expression(
        DB_name,
        {
            document,
            disallow_s7express: true,
            disallow_symbol_def: true,
            force: { type: DB_name }, // pin it to a global DB, not an instance DB
        },
    ).then(symbol => {
        DB.symbol = symbol;
    });

    /**
     * Parses an Interlock (IL) expression and returns an object with relevant details.
     *
     * If the `item` is undefined, it simply returns the item. If `item` is a string
     * or can be converted to a string, it attempts to find a reference in `data_dict`.
     * If found, it constructs and returns an object containing the reference,
     * a value string, trigger type, and comment.
     *
     * If `item` is not directly matched in `data_dict`, it proceeds to create an
     * expression using `make_s7_expression`, returning an object with the resultant
     * expression and other provided options.
     *
     * @param {string|object} item - The item to parse, expected to be a string or convertible to a string.
     * @param {object} [options={}] - Additional options for parsing the item.
     * @param {string} [options.comment] - A comment associated with the item.
     * @param {string} [options.s7_expr_desc] - Description for the S7 expression.
     * @param {string} [options.trigger_type] - Type of trigger related to the item.
     * @returns {object|null} - An object containing parsed details or null if parsing fails.
     */
    function parse_IL_expression(item, options = {}) {
        // biome-ignore lint/suspicious/noDoubleEquals: may be null
        if (item == undefined) return item;

        const {
            comment = '',
            s7_expr_desc = '',
            trigger_type = 'rising'
        } = options;
        const expression = isString(item) ? item.value : item;

        if (typeof expression === 'string') {
            if (expression.trim().toLowerCase() === 'enable') {
                elog(new SyntaxError(`interlock DB:${DB_name} 的 input、reset、output 中不能使用 enable!`));
            }
            const ref = data_dict[expression];
            if (ref) {
                const type = (ref.type ?? 'BOOL').toUpperCase();
                if (type !== 'BOOL') {
                    elog(new SyntaxError(`interlock DB:${DB_name} 的 data 项 ${ref.name} 类型为 ${type}，不能用作布尔值!`));
                }
                const value = { value: `"${DB_name}".${ref.name}` };
                return {
                    ref,
                    value,
                    trigger_type,
                    comment,
                }
            }
        }

        if (typeof expression === 'string' || isString(expression) || isSeq(expression)) {
            const ret = { trigger_type, comment };
            make_s7_expression(
                expression,
                {
                    document,
                    force: { type: 'BOOL' },
                    default: { comment },
                    s7_expr_desc,
                },
            ).then(expr => {
                ret.value = expr;
            });
            return ret;
        }

        return null;
    }

    /**
     * Parse a reset item
     * @param {string|node} item
     * @param {boolean} allow_inputs whether `inputs` may be used, only for the reset of an output
     * @returns {object}
     */
    function conv_rest(item, allow_inputs) {
        if (typeof item !== 'string' && !isString(item) && !isSeq(item)) {
            elog(new SyntaxError('interlock 的 reset 项必须是data项名称、S7符号或SCL表达式!'));
        }

        // A symbol definition is passed through as is
        let expr = isString(item) ? item.value : item;
        if (typeof expr === 'string' && expr.search(INPUTS_REGEX) >= 0) {
            if (!allow_inputs) elog(new SyntaxError(`interlock DB:${DB_name} 组级 reset 中不能使用 inputs，它只能用于 output 项的 reset!`));
            // `inputs` is the OR result of this group's inputs, held in VAR_TEMP output
            expr = expr.replace(INPUTS_REGEX, 'output');
        }
        const reset = parse_IL_expression(expr, {
            s7_expr_desc: `interlock DB:${DB_name} reset.value`,
            comment: ''
        });
        return reset;
    }

    /**
     * Parse one interlock group
     * @param {node} group_node the YAML map holding the group keys
     * @param {boolean} [is_shorthand=false] the list item itself is the group, its comment belongs to the DB
     * @returns {object}
     */
    function parse_group(group_node, is_shorthand = false) {
        // A missing comment falls back to the DB comment in build_list
        const comment = is_shorthand
            ? undefined
            : nullable_value(STRING, group_node.get('comment'))?.value;
        const interlock = {
            node: group_node,
            extra_code: nullable_value(STRING, group_node.get('extra_code'))?.value,
            comment
        };

        const input_node = group_node.get('input');
        if (!input_node || !isSeq(input_node) || input_node.items.length < 1) {
            elog(new SyntaxError("interlock的input_list必须有1项以上!")); // Cannot be empty
        }
        interlock.input_list = input_node.items.map((item) => {
            // if item is IL_expression then convert to input_item
            let input = parse_IL_expression(item, {
                s7_expr_desc: `interlock DB:${DB_name} input.value`,
                trigger_type: 'rising',
                comment: ''
            });
            if (!input) {
                if (!isMap(item)) elog(new SyntaxError(`interlock的input项${item}输入错误，必须是input对象、data项名称、S7符号或SCL表达式`));
                const trigger_type = nullable_value(STRING, item.get('trigger'))?.value.toLowerCase() ?? 'rising';
                if (!TRIGGER_TYPES.includes(trigger_type)) {
                    elog(new SyntaxError(`interlock DB:${DB_name} 的 input 项 trigger:${trigger_type} 无效，只能是 ${TRIGGER_TYPES.join('、')}!`));
                }
                const comment = new STRING(item.get('comment') ?? '').value;
                const and = item.get('and');
                const value = item.get('value');
                if (and) {
                    if (!isSeq(and)) elog(new SyntaxError('interlock 有 is_and 属性的 input 项必须是数组!'));
                    const items = and.items.map(item => {
                        const and_item = parse_IL_expression(item, {
                            s7_expr_desc: `interlock DB:${DB_name} input.value[index]`,
                        });
                        if (!and_item) elog(new SyntaxError(`interlock DB:${DB_name} 的 input 项 and 列表的每一项必须是data项名称、S7符号或SCL表达式!`));
                        return and_item;
                    });
                    input = { items, trigger_type, comment, };
                } else {
                    input = parse_IL_expression(value, {
                        s7_expr_desc: `interlock DB:${DB_name} input.value`,
                        trigger_type, comment,
                    });
                    if (!input) elog(new SyntaxError(`interlock DB:${DB_name} 的 input 对象必须有 value 或 and 属性，value 必须是data项名称、S7符号或SCL表达式!`));
                }
            }
            fields.push(input);
            return input;
        });

        const reset_node = group_node.get('reset');
        if (reset_node && !isSeq(reset_node)) elog(new SyntaxError('interlock 的 reset 列表必须是数组!'));
        interlock.reset_list = (reset_node?.items ?? []).map(item => conv_rest(item, false));

        const output_node = group_node.get('output');
        if (output_node && !isSeq(output_node)) elog(new SyntaxError('interlock 的 output 列表必须是数组!'));
        interlock.output_list = (output_node?.items ?? []).map(item => {
            // if item is IL_expression then convert to output_item
            let output = parse_IL_expression(item, {
                s7_expr_desc: `interlock DB:${DB_name} output.value`,
                comment: ''
            });
            if (!output) {
                if (!isMap(item)) {
                    elog(new SyntaxError('interlock 的 output 项必须是output对象、data项名称、S7符号或SCL表达式!'));
                }
                const comment = new STRING(item.get('comment') ?? '').value;
                const value = item.get('value');
                output = parse_IL_expression(value, {
                    s7_expr_desc: `interlock DB:${DB_name} output.value`,
                    comment,
                });
                if (!output) elog(new SyntaxError(`interlock DB:${DB_name} 的 output 对象必须有 value 属性，且必须是data项名称、S7符号或SCL表达式!`));
                const reset = item.get('reset');
                if (reset) output.reset = conv_rest(reset, true);
            }
            /**
             * @type {BOOL}
             */
            const inversion = ensure_value(
                BOOL,
                (isMap(item) && item.get('inversion')) ?? false
            );
            /**
             * @type {BOOL|null}
             */
            const defaultvalue = nullable_value(
                BOOL,
                isMap(item) && item.get('default')
            );
            output.setvalue = inversion.value ? 'FALSE' : 'TRUE';
            output.resetvalue = inversion.toString();
            output.defaultvalue = defaultvalue == null
                ? output.resetvalue
                : defaultvalue.toString();
            return output;
        });
        return interlock;
    }

    const enable = node.get('enable');
    // biome-ignore lint/suspicious/noDoubleEquals: may be null
    if (enable != undefined) {
        make_s7_expression(
            enable,
            {
                document,
                force: { type: 'BOOL' },
                s7_expr_desc: `interlock DB:${DB_name} enable.read`,
            },
        ).then(ret => {
            fields.enable.read = ret;
        });
    }
    const $enable = nullable_value(BOOL, node.get('$enable'))?.value;
    if ($enable !== undefined) {
        fields.enable.init = $enable ? 'TRUE' : 'FALSE';
    }

    // All data is parsed before any group, so every group can reference it
    const data_node = node.get('data');
    if (data_node && !isSeq(data_node)) elog(new SyntaxError('interlock 的 data 列表必须是数组!'));
    for (const item of (data_node?.items ?? [])) {
        let data;
        let name = isString(item) ? item.value : item;
        if (typeof name === 'string') {
            data = {
                name: item,
                s7_m_c: true
            };
        } else if (isMap(item)) {
            name = ensure_value(STRING, item.get('name'));
            const comment = ensure_value(STRING, item.get('comment') ?? '').value;
            let type = nullable_value(STRING, item.get('type'))?.value;
            type = is_common_type(type) ? type : 'BOOL';
            data = {
                name,
                type,
                s7_m_c: true,
                comment
            };
            const $value = item.get('$value');
            // biome-ignore lint/suspicious/noDoubleEquals: may be null
            if ($value != undefined) {
                try {
                    data.init = INIT_FORMATTERS[type.toUpperCase()]($value);
                } catch (e) {
                    elog(new SyntaxError(`interlock DB:${DB_name} 的 data 项 ${name} 的 $value 无效: ${e.message}`));
                }
            }
            const read = item.get('read');
            make_s7_expression(
                read,
                {
                    document,
                    force: { type },
                    default: { comment },
                    s7_expr_desc: `interlock DB:${DB_name} ${name}.read`,
                },
            ).then(ret => {
                data.read = ret;
            });
            const write = item.get('write');
            make_s7_expression(
                write,
                {
                    document,
                    force: { type },
                    default: { comment },
                    s7_expr_desc: `interlock DB:${DB_name} ${name}.write`,
                },
            ).then(ret => {
                data.write = ret;
            });
        } else {
            elog(new SyntaxError('interlock的data项输入错误!'));
        }
        fields.push(data);
        data_dict[name] = data;
    };

    if (node.has('groups')) {
        const DB_keys = GROUP_KEYS.filter(key => node.has(key));
        if (DB_keys.length) elog(new SyntaxError(`interlock 的 DB "${DB_name}" 有 groups 时，不能在 DB 层设置 ${DB_keys.join('、')}!`));
        const groups_node = node.get('groups');
        if (!isSeq(groups_node) || groups_node.items.length < 1) elog(new SyntaxError('interlock 的 groups 必须是至少有1项的数组!'));
        for (const group_node of groups_node.items) {
            if (!isMap(group_node)) elog(new SyntaxError('interlock 的 groups 项必须是对象!'));
            DB.interlocks.push(parse_group(group_node));
        }
    } else {
        // Shorthand: the list item itself is the only group
        DB.interlocks.push(parse_group(node, true));
    }
    return DB;
}

/**
 * First scan to extract symbols
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const { document, list } = area;
    const DB_names = new Set();
    area.list = list.map(node => parse_DB(document, node, DB_names));
}

export function build_list({ document, list }) {
    for (const DB of list) {
        const interlocks = DB.interlocks;
        // enable is read from an assignable address, not a literal or an expression
        const enable_read = DB.fields.enable.read;
        if (enable_read && !is_assignable(enable_read)) {
            elog(new SyntaxError(`interlock 的 DB "${DB.name}" 的 enable 必须是可赋值的地址（符号或单个变量），不能是字面量或表达式 "${enable_read.value}"；设初值请用 $enable!`));
        }
        // The DB must be a global DB: its type is itself and its address is a DB block
        if (DB.symbol.type !== DB.name || DB.symbol.block_name !== 'DB') {
            elog(new SyntaxError(`interlock 的 DB "${DB.name}" 必须是全局 DB 块，当前地址为 ${DB.symbol.address}!`));
        }
        // DB comment: list item comment, then symbol comment
        DB.comment ||= DB.symbol.comment ?? '';
        // Symbol comment: its own comment, then DB comment
        DB.symbol.comment ||= DB.comment;
        for (const interlock of interlocks) {
            interlock.comment ||= DB.comment;
        }

        const DB_name = DB.name;
        const S7_m_c = "{S7_m_c := 'true'}";
        const fields = DB.fields;
        const _fields = Object.values(fields);
        for (const item of _fields) {
            item.expression = `"${DB_name}".${item.name}`;
            if (item.read) item.assign_read = `${item.expression} := ${item.read.value};`;
            if (item.write) item.assign_write = `${item.write.value} := ${item.expression};`;
            const init_value = item.init
                ? ` := ${item.init}`
                : '';
            const type = item.type ?? 'BOOL';
            if (item.s7_m_c) item.declaration = `${item.name} ${S7_m_c} : ${type}${init_value} ;`;
            item.comment ??= '';
        }

        const declarations = _fields.filter(field => field.s7_m_c);
        DB.declarations = declarations;
        DB.read_list = declarations.filter(
            field => field.read && field.assign_read
        );
        DB.write_list = declarations.filter(
            field => field.write && field.assign_write
        );
        const edges = DB.edges;
        for (const interlock of interlocks) { // Process configuration to form complete data
            for (const input of interlock.input_list) {
                let value;
                if (input.items) {
                    const and_value = input.items.map(item => {
                        const item_value = item.value;
                        return item_value.isExpress ? `(${item_value.value})` : item_value.value;
                    }).join(' AND ');
                    value = `(${and_value})`;
                    input.value = { value: and_value, isExpress: false };
                } else {
                    const input_value = input.value;
                    value = input_value.isExpress ? `(${input_value.value})` : input_value.value;
                }
                if (input.trigger_type === 'falling') {
                    const edge_field = `${input.name}_fo`;
                    input.edge_field = edge_field;
                    input.trigger = `NOT ${value} AND "${DB_name}".${edge_field}`;
                    edges.push(input);
                } else if (input.trigger_type === 'change') {
                    const edge_field = `${input.name}_fo`;
                    input.edge_field = edge_field;
                    input.trigger = `${value} XOR "${DB_name}".${edge_field}`;
                    edges.push(input);
                } else if (input.trigger_type === 'on') {
                    input.trigger = value;
                } else if (input.trigger_type === 'off') {
                    input.trigger = `NOT ${value}`;
                } else { // default rising
                    const edge_field = `${input.name}_fo`;
                    input.edge_field = edge_field;
                    input.trigger = `${value} AND NOT "${DB_name}".${edge_field}`;
                    edges.push(input);
                }
            }
            for (const reset of interlock.reset_list) {
                if (reset.ref && !reset.ref.read) {
                    reset.ref.resettable = true;
                }
            }
            for (const output of interlock.output_list) {
                if (output.ref) {
                    if (output.ref.read) elog(new SyntaxError('interlock 的 output 项不能有 read 属性!'));
                }
                const reset = output.reset;
                if (reset?.ref && !reset.ref.read) {
                    reset.ref.resettable = true;
                }
            }
        }
        // A resettable data item used as an output is cleared at the end of every cycle
        const output_fields = new Set(interlocks.flatMap(
            interlock => interlock.output_list.map(output => output.ref).filter(Boolean)
        ));
        for (const field of output_fields) {
            if (!field.resettable) continue;
            console.error(`warning: 警告：
        info 信息: data ${field.name} is both an output and a reset condition, it is cleared at the end of every cycle. data 项 ${field.name} 既是输出又是复位条件，每周期末被清零，HMI 与 write 只能看到 FALSE
        file 文件:"${document.gcl.file}"
        item 条目:interlock DB "${DB_name}"`);
        }
    }
}

export function gen({ document, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { LOOP_NAME };
    const template = 'interlock.template';
    return [{ distance, output_dir, tags, template }];
}

export function gen_copy_list() {
    return [];
}

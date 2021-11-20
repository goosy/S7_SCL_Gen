const common_type = ['BOOL', 'BYTE', 'INT', 'WORD', 'REAL'];
export function gen_symbols_data(CPU, symbols) {
    const exist_name = {};
    const exist_bno = {};
    const { DB_list } = CPU;
    // 检查重复并建立索引
    symbols.forEach(symbol => {
        const name = symbol.name;
        if (exist_name[name]) throw new Error(`存在重复的符号名称 ${name}!`)
        exist_name[name] = true;
        if (symbol.block_name === 'DB') {
            symbol.block_no = DB_list.push(symbol.block_no);
        }
        const block_addr = symbol.block_name + symbol.block_no;
        if (exist_bno[block_addr]) throw new Error(`存在重复的地址 ${name}!`)
        exist_bno[block_addr] = true;
        symbols[name] = symbol;
    });
    // 补全类型
    symbols.forEach(symbol => {
        if (symbol.block_name == "OB" || symbol.block_name == "FB" || symbol.block_name == "FC" || symbol.type == null){
            symbol.type = symbol.name;
        }
        if (common_type.includes(symbol.type)) {
            symbol.type_name = symbol.type;
            symbol.type_no = '';
        } else {
            const type_block = symbols[symbol.type];
            symbol.type_name = type_block.block_name;
            symbol.type_no = type_block.block_no;
        }
    });
}
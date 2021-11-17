/**
 * 将item左侧用占位符填充至指定长度
 * @date 2021-11-17
 * @param {number|string} item
 * @param {number} length
 * @param {string} placeholder=''
 * @returns {string}
 */
export function str_padding_left(item, length, placeholder = ' ') {
    const str = Array(length).join(placeholder) + placeholder + item;
    return str.slice(-length);
}
/**
 * 将item右侧用占位符填充至指定长度
 * @date 2021-11-17
 * @param {number|string} item
 * @param {number} length
 * @param {string} placeholder=''
 * @returns {string}
 */
export function str_padding_right(item, length, placeholder = ' ') {
    const str = item + placeholder + Array(length).join(placeholder);
    return str.slice(0, length);
}

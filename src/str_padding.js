export function str_padding_left(item, length, placeholder = ' ') {
    const str = Array(length).join(placeholder) + item;
    return str.slice(-length);
}
export function str_padding_right(item, length, placeholder = ' ') {
    const str = item + Array(length).join(placeholder);
    return str.slice(0, length);
}


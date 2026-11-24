/**
 * 符号なし LEB128 の読み書き。
 * WASM のメモリの上限は LEB128 で書かれているので、同じバイト数のまま書き換える。
 */

const MAX_U32 = 0xffff_ffff;

export interface Leb128Read {
  readonly value: number;
  readonly next: number;
}

/** 符号なし LEB128 を読む。5 バイトを超える・途中で切れる場合は undefined。 */
export const readUnsignedLeb128 = (bytes: Uint8Array, offset: number): Leb128Read | undefined => {
  let value = 0;
  let scale = 1;
  for (let index = 0; index < 5; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) return undefined;
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return { value, next: offset + index + 1 };
    scale *= 128;
  }
  return undefined;
};

/**
 * 値をちょうど byteLength バイトの符号なし LEB128 にする。
 * 足りない分は末尾に 0 のグループを足して埋める（wasm は上限バイト数までの詰め物を許す）。
 */
export const encodeUnsignedLeb128Padded = (value: number, byteLength: number): Uint8Array | undefined => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32 || !Number.isInteger(byteLength) || byteLength < 1) {
    return undefined;
  }
  const groups: number[] = [];
  let rest = value;
  do {
    groups.push(rest % 128);
    rest = Math.floor(rest / 128);
  } while (rest > 0);
  if (groups.length > byteLength) return undefined;
  while (groups.length < byteLength) groups.push(0);
  const out = new Uint8Array(byteLength);
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index] ?? 0;
    out[index] = index === groups.length - 1 ? group : group | 0x80;
  }
  return out;
};

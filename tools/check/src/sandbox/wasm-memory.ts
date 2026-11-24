/**
 * WASM のメモリの上限（ページ数）を、読み込んだバイト列の上だけで書き換える（1 つ目の床）。
 *
 * 同梱の QuickJS は「メモリを import する」形でビルドされている。
 * import の型（limits）に最小ページ数と最大ページ数が LEB128 で入っているので、
 * ここを同じバイト数のまま小さい値に置き換える。ファイルは一切変更しない。
 */
import { encodeUnsignedLeb128Padded, readUnsignedLeb128 } from "./leb128.ts";

/** 方法1 の上限。1024 ページ = 64MiB。 */
export const CAPPED_PAGES = 1024;

const SECTION_IMPORT = 2;
const SECTION_MEMORY = 5;
const IMPORT_KIND_FUNC = 0x00;
const IMPORT_KIND_TABLE = 0x01;
const IMPORT_KIND_MEMORY = 0x02;
const IMPORT_KIND_GLOBAL = 0x03;
const IMPORT_KIND_TAG = 0x04;

/** メモリの型（limits）が書かれている場所。 */
export interface MemoryLimitsSite {
  readonly where: string;
  readonly minPages: number;
  readonly maxPages: number;
  /** 最大ページ数の LEB128 が始まるバイト位置。 */
  readonly maxOffset: number;
  /** 最大ページ数の LEB128 のバイト数。 */
  readonly maxByteLength: number;
}

interface Cursor {
  readonly bytes: Uint8Array;
  offset: number;
}

const readByte = (cursor: Cursor): number | undefined => {
  const value = cursor.bytes[cursor.offset];
  if (value === undefined) return undefined;
  cursor.offset += 1;
  return value;
};

const readLeb = (cursor: Cursor): number | undefined => {
  const read = readUnsignedLeb128(cursor.bytes, cursor.offset);
  if (!read) return undefined;
  cursor.offset = read.next;
  return read.value;
};

const readName = (cursor: Cursor): string | undefined => {
  const length = readLeb(cursor);
  if (length === undefined || length > cursor.bytes.length) return undefined;
  const start = cursor.offset;
  const end = start + length;
  if (end > cursor.bytes.length) return undefined;
  cursor.offset = end;
  return new TextDecoder().decode(cursor.bytes.slice(start, end));
};

const readLimits = (cursor: Cursor, where: string): MemoryLimitsSite | undefined => {
  const flags = readByte(cursor);
  if (flags === undefined) return undefined;
  const min = readLeb(cursor);
  if (min === undefined) return undefined;
  if ((flags & 0x01) === 0) return undefined;
  const maxOffset = cursor.offset;
  const max = readLeb(cursor);
  if (max === undefined) return undefined;
  return { where, minPages: min, maxPages: max, maxOffset, maxByteLength: cursor.offset - maxOffset };
};

const skipLimits = (cursor: Cursor): boolean => {
  const flags = readByte(cursor);
  if (flags === undefined || readLeb(cursor) === undefined) return false;
  if ((flags & 0x01) === 0) return true;
  return readLeb(cursor) !== undefined;
};

const readImportEntry = (cursor: Cursor, index: number, sites: MemoryLimitsSite[]): boolean => {
  const moduleName = readName(cursor);
  const fieldName = readName(cursor);
  const kind = readByte(cursor);
  if (moduleName === undefined || fieldName === undefined || kind === undefined) return false;
  const where = `import ${moduleName}.${fieldName} (#${index})`;
  if (kind === IMPORT_KIND_MEMORY) {
    const site = readLimits(cursor, where);
    if (site) sites.push(site);
    return true;
  }
  if (kind === IMPORT_KIND_FUNC) return readLeb(cursor) !== undefined;
  if (kind === IMPORT_KIND_TABLE) return readByte(cursor) !== undefined && skipLimits(cursor);
  if (kind === IMPORT_KIND_GLOBAL) return readByte(cursor) !== undefined && readByte(cursor) !== undefined;
  if (kind === IMPORT_KIND_TAG) return readByte(cursor) !== undefined && readLeb(cursor) !== undefined;
  return false;
};

const scanSection = (cursor: Cursor, id: number, end: number, sites: MemoryLimitsSite[]): boolean => {
  if (id === SECTION_IMPORT) {
    const count = readLeb(cursor);
    if (count === undefined) return false;
    for (let index = 0; index < count; index += 1) {
      if (!readImportEntry(cursor, index, sites)) return false;
    }
  } else if (id === SECTION_MEMORY) {
    const count = readLeb(cursor);
    if (count === undefined) return false;
    for (let index = 0; index < count; index += 1) {
      const site = readLimits(cursor, `defined memory #${index}`);
      if (site) sites.push(site);
    }
  }
  cursor.offset = end;
  return true;
};

/** wasm のバイト列から、メモリの最大ページ数が書かれている場所をすべて集める。 */
export const findMemoryLimits = (bytes: Uint8Array): readonly MemoryLimitsSite[] => {
  const cursor: Cursor = { bytes, offset: 8 };
  const sites: MemoryLimitsSite[] = [];
  while (cursor.offset < bytes.length) {
    const id = readByte(cursor);
    const size = readLeb(cursor);
    if (id === undefined || size === undefined) break;
    const end = cursor.offset + size;
    if (end > bytes.length) break;
    if (!scanSection(cursor, id, end, sites)) break;
  }
  return sites;
};

export interface PatchResult {
  readonly bytes: Uint8Array;
  readonly sites: readonly MemoryLimitsSite[];
  readonly error?: string;
}

/** メモリの最大ページ数を targetPages に書き換えた新しいバイト列を返す。 */
export const patchMemoryMaxPages = (bytes: Uint8Array, targetPages: number): PatchResult => {
  const sites = findMemoryLimits(bytes);
  const out = new Uint8Array(bytes);
  if (sites.length === 0) return { bytes: out, sites, error: "メモリの最大ページ数が見つからなかった" };
  for (const site of sites) {
    const encoded = encodeUnsignedLeb128Padded(targetPages, site.maxByteLength);
    if (!encoded) {
      return {
        bytes: out,
        sites,
        error: `${site.where}: ${targetPages} ページを ${site.maxByteLength} バイトの LEB128 で表せない`,
      };
    }
    out.set(encoded, site.maxOffset);
  }
  return { bytes: out, sites };
};

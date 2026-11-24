/**
 * QuickJS を使う前の、形の検査。
 * 題名から名前を取り、本文からコードブロックを 1 つだけ取り、読み込みの指定を調べる。
 */

export const MAX_BODY_CHARS = 65_536;
export const MAX_CODE_CHARS = 48_000;

/** 題名が `contribute: <名前>` の形なら、名前の部分を返す。 */
export const parseTitle = (title: string): string | undefined => {
  const match = /^contribute: (.+)$/.exec(title.trim());
  return match?.[1];
};

export type CodeBlocks =
  | { readonly kind: "none" }
  | { readonly kind: "many" }
  | { readonly kind: "one"; readonly code: string };

/**
 * 本文から ```js で始まり ``` で終わるブロックを数える。
 * 閉じていないブロックは数えない。行の前後の空白は無視する。
 */
export const extractCodeBlock = (body: string): CodeBlocks => {
  const blocks: string[] = [];
  let current: string[] | undefined;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (current === undefined) {
      if (line === "```js") {
        current = [];
      }
    } else if (line === "```") {
      blocks.push(current.join("\n"));
      current = undefined;
    } else {
      current.push(raw);
    }
  }
  if (blocks.length === 0) return { kind: "none" };
  if (blocks.length > 1) return { kind: "many" };
  return { kind: "one", code: blocks[0] ?? "" };
};

/** 静的 import と export ... from の指定を拾う正規表現（呼ぶたびに新しく作る）。 */
const specifierPatterns = (): readonly RegExp[] => [
  /\bimport\s+(?:[^;'"]*?\s+from\s+)?(["'])([^"'\n]+)\1/g,
  /\bexport\s+(?:\*[^;'"]*?|\{[^}]*?\})\s*from\s*(["'])([^"'\n]+)\1/g,
];

const DYNAMIC_IMPORT = /\bimport\s*\(/;
const ROOM_PREFIX = "room:";

/** コードが参照している `room:<名前>` の名前を、重複なしで返す。 */
export const depsOf = (code: string): readonly string[] => {
  const names: string[] = [];
  for (const pattern of specifierPatterns()) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier === undefined || !specifier.startsWith(ROOM_PREFIX)) continue;
      const name = specifier.slice(ROOM_PREFIX.length);
      if (name === "" || names.includes(name)) continue;
      names.push(name);
    }
  }
  return names;
};

export type ImportCheck =
  | { readonly kind: "ok"; readonly deps: readonly string[] }
  | { readonly kind: "bad" };

/**
 * 読み込みの指定を調べる。許すのは静的な `room:<名前>` だけ。
 * `import(` の形（実行時の読み込み）は、指定の中身にかかわらず許さない。
 *
 * 注意: 字句解析はせず正規表現で見ているので、コメントや文字列の中に
 * `import x from "..."` と書かれていても拾ってしまう。厳しすぎる側に倒した判定である。
 */
export const checkImports = (code: string): ImportCheck => {
  if (DYNAMIC_IMPORT.test(code)) return { kind: "bad" };
  for (const pattern of specifierPatterns()) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier === undefined) continue;
      if (!specifier.startsWith(ROOM_PREFIX) || specifier.length === ROOM_PREFIX.length) {
        return { kind: "bad" };
      }
    }
  }
  return { kind: "ok", deps: depsOf(code) };
};

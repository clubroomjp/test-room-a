/**
 * 符号から、イシューに書くコメントの文面を作る。
 *
 * 使い方: node tools/check/src/report-text.ts <符号> <名前> <sha256>
 *
 * 文面に入れてよい可変の値は、正規表現を通った名前と、sha256 の先頭 12 文字だけ。
 * 通らない値は使わず、その部分を省いた文面にする。
 *
 * 最後の行には、ホストの道具（adopt-tool）が読む印を足す。
 * 印に入れる値も、正規表現を通ったものだけ。通らなければ `-` にする。
 */
import { isName, isOutcome, isSha256, type Outcome } from "./outcome.ts";

const LABELS: Readonly<Record<Outcome, { readonly ja: string; readonly en: string }>> = {
  ok: {
    ja: "検査に通りました。採否はホストが決めます。",
    en: "The check passed. The host will decide whether to accept it.",
  },
  skip: {
    ja: "このイシューは貢献の形ではないため、何も検査していません。",
    en: "This issue is not a contribution, so nothing was checked.",
  },
  "bad-name": {
    ja: "名前の形が正しくありません。小文字で始まり、小文字・数字・ハイフンだけを使えます。",
    en: "The name is not in the allowed form: start with a lowercase letter, then lowercase letters, digits or hyphens.",
  },
  "no-code": {
    ja: "コードブロックがありません。```js で始まるブロックを 1 つ書いてください。",
    en: "No code block was found. Add exactly one block that starts with ```js.",
  },
  "many-code": {
    ja: "コードブロックが複数あります。1 つだけにしてください。",
    en: "More than one code block was found. Keep exactly one.",
  },
  "too-large": {
    ja: "本文またはコードが大きすぎます。短くしてください。",
    en: "The body or the code is too large. Please shorten it.",
  },
  "bad-import": {
    ja: "読み込みの指定が使えません。静的な room:<名前> だけを使えます。",
    en: "The import is not allowed. Only static room:<name> imports are accepted.",
  },
  "missing-dep": {
    ja: "読み込もうとしたモジュールが部屋にありません。",
    en: "A module you tried to import does not exist in this room.",
  },
  "too-many-deps": {
    ja: "依存先が多すぎます。16 個までにしてください。",
    en: "Too many dependencies. Keep it to 16 or fewer.",
  },
  "load-error": {
    ja: "コードを読み込めませんでした。例外が出ています。",
    en: "The code could not be loaded. It threw an exception.",
  },
  timeout: {
    ja: "時間切れになりました。処理を短くしてください。",
    en: "The check timed out. Please make the work shorter.",
  },
  memory: {
    ja: "メモリを使いすぎました。確保する量を減らしてください。",
    en: "The code used too much memory. Please allocate less.",
  },
  "bad-describe": {
    ja: "describe() の戻り値が大きすぎるか、JSON にできません。",
    en: "The value returned by describe() is too large or cannot be turned into JSON.",
  },
  internal: {
    ja: "検査の仕組みが止まりました。ホストが確認します。",
    en: "The check itself failed. The host will look into it.",
  },
};

/** 機械が読む印。値は正規表現を通ったものだけを入れ、通らなければ `-` にする。 */
const markerLine = (code: Outcome, name: string | undefined, sha256: string | undefined): string =>
  `<!-- jamroom-check v1 code=${code} sha256=${sha256 ?? "-"} name=${name ?? "-"} -->`;

/** 符号から文面を作る。正規表現を通らない値は使わない。 */
export const reportText = (rawCode: string | undefined, rawName: string | undefined, rawSha: string | undefined): string => {
  const code: Outcome = isOutcome(rawCode) ? rawCode : "internal";
  const name = isName(rawName) ? rawName : undefined;
  const sha256 = isSha256(rawSha) ? rawSha : undefined;
  const shortSha = sha256 === undefined ? undefined : sha256.slice(0, 12);
  const label = LABELS[code];
  const jaDetail = name === undefined ? "" : `（名前: ${name}${shortSha === undefined ? "" : `、コード: ${shortSha}`}）`;
  const enDetail = name === undefined ? "" : ` (name: ${name}${shortSha === undefined ? "" : `, code: ${shortSha}`})`;
  return `${label.ja}${jaDetail}\n${label.en}${enDetail}\n${markerLine(code, name, sha256)}\n`;
};

const main = (): void => {
  const [rawCode, rawName, rawSha] = process.argv.slice(2);
  process.stdout.write(reportText(rawCode, rawName, rawSha));
};

main();

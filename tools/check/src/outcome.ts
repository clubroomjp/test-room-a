/**
 * 検査の結果の符号と、結果ファイルの形。
 *
 * 外へ出してよいのは、ここの符号と、正規表現で確かめた値だけである。
 * 訪問者由来の文面（本文、題名、例外の説明）は結果に入れない。
 */

export const OUTCOMES = [
  "ok",
  "skip",
  "bad-name",
  "no-code",
  "many-code",
  "too-large",
  "bad-import",
  "missing-dep",
  "too-many-deps",
  "load-error",
  "timeout",
  "memory",
  "bad-describe",
  "internal",
] as const;

export type Outcome = (typeof OUTCOMES)[number];

/** 名前の形。小文字で始まり、小文字・数字・ハイフンだけ。40 文字まで。 */
export const NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** コードの SHA-256（16 進、小文字）。 */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface CheckResult {
  readonly code: Outcome;
  readonly number: number;
  readonly name: string | null;
  readonly sha256: string | null;
  readonly chars: number | null;
  readonly ms: number;
}

const RESULT_KEYS = ["code", "number", "name", "sha256", "chars", "ms"] as const;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isOutcome = (value: unknown): value is Outcome =>
  typeof value === "string" && (OUTCOMES as readonly string[]).includes(value);

export const isName = (value: unknown): value is string =>
  typeof value === "string" && NAME_PATTERN.test(value);

export const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && SHA256_PATTERN.test(value);

export const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** 結果を書き出す文字列。項目はこの 6 つだけ。 */
export const serializeResult = (result: CheckResult): string =>
  `${JSON.stringify(
    {
      code: result.code,
      number: result.number,
      name: result.name,
      sha256: result.sha256,
      chars: result.chars,
      ms: result.ms,
    },
    null,
    2,
  )}\n`;

/** 読み戻した結果を、項目の過不足まで含めて検める。 */
export const parseResult = (value: unknown): CheckResult | undefined => {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== RESULT_KEYS.length) return undefined;
  if (!RESULT_KEYS.every((key) => keys.includes(key))) return undefined;
  const code = value["code"];
  const number = value["number"];
  const name = value["name"];
  const sha256 = value["sha256"];
  const chars = value["chars"];
  const ms = value["ms"];
  if (!isOutcome(code)) return undefined;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) return undefined;
  if (name !== null && !isName(name)) return undefined;
  if (sha256 !== null && !isSha256(sha256)) return undefined;
  if (chars !== null && (typeof chars !== "number" || !Number.isSafeInteger(chars) || chars < 0)) return undefined;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return undefined;
  return { code, number, name, sha256, chars, ms };
};

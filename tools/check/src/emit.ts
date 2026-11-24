/**
 * 結果のファイルを読み直し、GitHub Actions の出力に書く行を作る。
 *
 * `$GITHUB_OUTPUT` へは、この標準出力をそのまま追記する。
 * 検査に通らない値は空にして、符号だけ internal にする。
 * 訪問者由来の文面が混ざる余地を残さないため、出すのは 4 行だけ。
 */
import { readFile } from "node:fs/promises";
import { isName, isPositiveInteger, isSha256, parseResult, type CheckResult } from "./outcome.ts";

const FALLBACK: CheckResult = { code: "internal", number: 0, name: null, sha256: null, chars: null, ms: 0 };

const isSafe = (result: CheckResult): boolean =>
  isPositiveInteger(result.number) &&
  (result.name === null || isName(result.name)) &&
  (result.sha256 === null || isSha256(result.sha256));

const readResult = async (path: string | undefined): Promise<CheckResult | undefined> => {
  if (path === undefined) return undefined;
  try {
    return parseResult(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return undefined;
  }
};

const main = async (): Promise<void> => {
  const parsed = await readResult(process.argv[2]);
  const safe = parsed !== undefined && isSafe(parsed) ? parsed : FALLBACK;
  const lines = [
    `code=${safe.code}`,
    `number=${isPositiveInteger(safe.number) ? String(safe.number) : ""}`,
    `name=${safe.name ?? ""}`,
    `sha256=${safe.sha256 ?? ""}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
};

await main();

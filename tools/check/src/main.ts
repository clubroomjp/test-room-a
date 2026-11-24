/**
 * 検査の入口。
 *
 * 使い方: node tools/check/src/main.ts <イベントのJSON> <部屋の根> <結果を書くパス>
 *
 * どんな入力でも例外で落ちず、結果を書いて終了コード 0 で終わる。
 * 標準出力には符号と番号だけを出し、本文やコードは出さない。
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEvent } from "./event.ts";
import { readRoomModules, resolveDependencies } from "./manifest.ts";
import { isName, serializeResult, type CheckResult, type Outcome } from "./outcome.ts";
import { runSandbox } from "./sandbox/parent.ts";
import { checkImports, extractCodeBlock, MAX_BODY_CHARS, MAX_CODE_CHARS, parseTitle } from "./shape.ts";

const build = (number: number, code: Outcome, extra: Partial<CheckResult> = {}): CheckResult => ({
  code,
  number,
  name: null,
  sha256: null,
  chars: null,
  ms: 0,
  ...extra,
});

const inspect = async (eventPath: string, roomRoot: string): Promise<CheckResult> => {
  let text: string;
  try {
    text = await readFile(eventPath, "utf8");
  } catch {
    return build(0, "internal");
  }
  const event = parseEvent(text);
  if (!event) return build(0, "internal");

  const name = parseTitle(event.title);
  if (name === undefined) return build(event.number, "skip");
  if (!isName(name)) return build(event.number, "bad-name");
  if (event.body.length > MAX_BODY_CHARS) return build(event.number, "too-large", { name });

  const block = extractCodeBlock(event.body);
  if (block.kind === "none") return build(event.number, "no-code", { name });
  if (block.kind === "many") return build(event.number, "many-code", { name });

  const code = block.code;
  const withCode = {
    name,
    sha256: createHash("sha256").update(code, "utf8").digest("hex"),
    chars: code.length,
  };
  if (code.length > MAX_CODE_CHARS) return build(event.number, "too-large", withCode);

  const imports = checkImports(code);
  if (imports.kind === "bad") return build(event.number, "bad-import", withCode);

  const room = await readRoomModules(roomRoot);
  if (!room) return build(event.number, "internal", withCode);
  const resolved = await resolveDependencies(roomRoot, room, imports.deps);
  if (resolved.kind === "error") return build(event.number, resolved.code, withCode);

  const outcome = await runSandbox({ name, code, deps: resolved.sources });
  return build(event.number, outcome, withCode);
};

const main = async (): Promise<void> => {
  const startedAt = Date.now();
  const [eventPath, roomRoot, outPath] = process.argv.slice(2);
  let result: CheckResult;
  try {
    result = eventPath !== undefined && roomRoot !== undefined ? await inspect(eventPath, roomRoot) : build(0, "internal");
  } catch {
    result = build(0, "internal");
  }
  const finished: CheckResult = { ...result, ms: Date.now() - startedAt };
  if (outPath !== undefined) {
    try {
      await writeFile(outPath, serializeResult(finished), "utf8");
    } catch {
      // 結果を書けないときは、標準出力だけを残して終わる。
    }
  }
  process.stdout.write(`${finished.code} ${finished.number}\n`);
};

await main().catch(() => {
  // 何があっても 0 で終わる（結果を書けなかった場合は emit が internal にする）。
});
process.exitCode = 0;

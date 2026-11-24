/**
 * 親から子へ渡す仕事の形と、子が返す符号。
 * 子は標準入力から読んだ JSON を、必ずここで検めてから使う。
 */
import { isRecord } from "../outcome.ts";

export interface SandboxDep {
  readonly name: string;
  readonly source: string;
}

export interface SandboxJob {
  readonly name: string;
  readonly code: string;
  readonly deps: readonly SandboxDep[];
}

/** 子が返してよい符号。訪問者由来の文面は含めない。 */
export const SANDBOX_OUTCOMES = ["ok", "load-error", "timeout", "memory", "bad-describe", "internal"] as const;

export type SandboxOutcome = (typeof SANDBOX_OUTCOMES)[number];

export const isSandboxOutcome = (value: unknown): value is SandboxOutcome =>
  typeof value === "string" && (SANDBOX_OUTCOMES as readonly string[]).includes(value);

/** 標準入力の上限。候補と依存先を合わせて 4MB まで。 */
export const MAX_JOB_BYTES = 4 * 1024 * 1024;

export const parseJob = (value: unknown): SandboxJob | undefined => {
  if (!isRecord(value)) return undefined;
  const name = value["name"];
  const code = value["code"];
  const deps = value["deps"];
  if (typeof name !== "string" || typeof code !== "string" || !Array.isArray(deps)) return undefined;
  if (name.length + code.length > MAX_JOB_BYTES) return undefined;
  const parsed: SandboxDep[] = [];
  for (const item of deps) {
    if (!isRecord(item)) return undefined;
    const depName = item["name"];
    const source = item["source"];
    if (typeof depName !== "string" || typeof source !== "string") return undefined;
    if (depName.length + source.length > MAX_JOB_BYTES) return undefined;
    parsed.push({ name: depName, source });
  }
  return { name, code, deps: parsed };
};

/** 子が標準出力に書いた 1 行の報告を読む。 */
export const parseReport = (text: string): SandboxOutcome | undefined => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const outcome = parsed["outcome"];
  return isSandboxOutcome(outcome) ? outcome : undefined;
};

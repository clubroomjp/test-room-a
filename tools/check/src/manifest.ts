/**
 * 部屋の manifest.json と、依存先モジュールの読み込み。
 * manifest に載っている名前だけを、部屋の根の下の安全な相対パスから読む。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isRecord, type Outcome } from "./outcome.ts";
import { depsOf, MAX_CODE_CHARS } from "./shape.ts";

/** 依存先は 16 個まで。 */
export const MAX_DEPS = 16;

export interface RoomModules {
  /** 名前 → 部屋の根からの相対パス。 */
  readonly paths: ReadonlyMap<string, string>;
}

/** 部屋の根の外へ出ない、素直な相対パスだけを受け付ける。 */
const isSafeRelativePath = (path: string): boolean => {
  if (path === "" || path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.includes("..") || path.includes("\\") || path.includes("\0")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return true;
};

/** manifest.json を読み、モジュールの名前とパスだけを取り出す。 */
export const readRoomModules = async (roomRoot: string): Promise<RoomModules | undefined> => {
  let text: string;
  try {
    text = await readFile(resolve(roomRoot, "manifest.json"), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const modules = parsed["modules"];
  if (!Array.isArray(modules)) return undefined;
  const paths = new Map<string, string>();
  for (const item of modules) {
    if (!isRecord(item)) return undefined;
    const name = item["name"];
    const path = item["path"];
    if (typeof name !== "string" || name === "" || paths.has(name)) return undefined;
    if (typeof path !== "string" || !isSafeRelativePath(path)) return undefined;
    paths.set(name, path);
  }
  return { paths };
};

export type DepResolution =
  | { readonly kind: "ok"; readonly sources: readonly { readonly name: string; readonly source: string }[] }
  | { readonly kind: "error"; readonly code: Outcome };

/**
 * 依存先を、依存先の依存先までたどって読む。
 * manifest に無い名前があれば missing-dep、16 個を超えたら too-many-deps。
 */
export const resolveDependencies = async (
  roomRoot: string,
  room: RoomModules,
  roots: readonly string[],
): Promise<DepResolution> => {
  const sources = new Map<string, string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || sources.has(name)) continue;
    const relative = room.paths.get(name);
    if (relative === undefined) return { kind: "error", code: "missing-dep" };
    let source: string;
    try {
      source = await readFile(resolve(roomRoot, relative), "utf8");
    } catch {
      // manifest に載っているのに読めないのは、部屋の側の不備。
      return { kind: "error", code: "internal" };
    }
    if (source.length > MAX_CODE_CHARS) return { kind: "error", code: "too-large" };
    sources.set(name, source);
    if (sources.size > MAX_DEPS) return { kind: "error", code: "too-many-deps" };
    for (const dependency of depsOf(source)) queue.push(dependency);
  }
  return { kind: "ok", sources: [...sources].map(([name, source]) => ({ name, source })) };
};

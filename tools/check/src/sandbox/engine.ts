/**
 * WASM のメモリの最大値を 64MiB に書き換えた QuickJS を読み込む（1 つ目の床）。
 * 書き換えるのは読み込んだバイト列だけで、node_modules のファイルには触らない。
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC } from "quickjs-emscripten";
import type { QuickJSWASMModule } from "quickjs-emscripten";
import { CAPPED_PAGES, patchMemoryMaxPages } from "./wasm-memory.ts";

const PACKAGE = "@jitl/quickjs-wasmfile-release-sync";
const FALLBACK_PATH = `../../node_modules/${PACKAGE}/dist/emscripten-module.wasm`;

/** wasm のファイルの場所。quickjs-emscripten が連れてくる版を使う。 */
const wasmPath = (): string => {
  try {
    return createRequire(import.meta.url).resolve(`${PACKAGE}/wasm`);
  } catch {
    return fileURLToPath(new URL(FALLBACK_PATH, import.meta.url));
  }
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
};

const start = async (): Promise<QuickJSWASMModule> => {
  const bytes = new Uint8Array(await readFile(wasmPath()));
  const patched = patchMemoryMaxPages(bytes, CAPPED_PAGES);
  if (patched.error !== undefined) throw new Error(patched.error);
  const site = patched.sites[0];
  if (site === undefined || site.minPages > CAPPED_PAGES) throw new Error("メモリの上限を書き換えられない");
  const variant = newVariant(RELEASE_SYNC, {
    wasmBinary: toArrayBuffer(patched.bytes),
    // emscripten の JS 側も WebAssembly.Memory を作るので、こちらも揃える。
    wasmMemory: new WebAssembly.Memory({ initial: site.minPages, maximum: CAPPED_PAGES }),
  });
  return newQuickJSWASMModuleFromVariant(variant);
};

let cached: Promise<QuickJSWASMModule> | undefined;

/** 同じプロセス（ワーカー）では 1 回だけ読み込む。 */
export const loadEngine = (): Promise<QuickJSWASMModule> => {
  cached ??= start();
  return cached;
};

/**
 * QuickJS の中でゲストを動かす部分。ホストの機能は一つも渡さない。
 *
 * 候補と依存先をモジュールとして読み込み、describe があれば引数なしで呼ぶ。
 * 例外の文面は、符号を決めるためだけに使い、外へは出さない。
 */
import { DefaultIntrinsics, Scope } from "quickjs-emscripten";
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from "quickjs-emscripten";
import { GUEST_DEADLINE_MS, GUEST_MEMORY_BYTES, GUEST_STACK_BYTES, HELPERS, MAX_DESCRIBE_BYTES, PRELUDE } from "./guest.ts";
import type { SandboxJob, SandboxOutcome } from "./job.ts";

type Phase = "prelude" | "load" | "describe";

type Attempt =
  | { readonly failed: false; readonly handle: QuickJSHandle }
  | { readonly failed: true; readonly message: string };

interface Helpers {
  readonly encode: QuickJSHandle;
}

/** 例外の文面を取り出す。分類にだけ使い、400 文字で切る。 */
const errorText = (vm: QuickJSContext, scope: Scope, handle: QuickJSHandle): string => {
  const parts: string[] = [];
  try {
    const nameHandle = scope.manage(vm.getProp(handle, "name"));
    if (vm.typeof(nameHandle) === "string") parts.push(vm.getString(nameHandle).slice(0, 100));
    const messageHandle = scope.manage(vm.getProp(handle, "message"));
    if (vm.typeof(messageHandle) === "string") parts.push(vm.getString(messageHandle).slice(0, 300));
  } catch {
    // 取り出せないときは下の dump に任せる。
  }
  if (parts.length > 0) return parts.join(": ");
  try {
    const dumped: unknown = vm.dump(handle);
    return typeof dumped === "string" ? dumped.slice(0, 400) : "guest error";
  } catch {
    return "guest error";
  }
};

const classify = (phase: Phase, interrupted: boolean, message: string): SandboxOutcome => {
  if (interrupted) return "timeout";
  const lower = message.toLowerCase();
  if (
    lower.includes("out of memory") ||
    lower.includes("memory access out of bounds") ||
    lower.includes("string too long") ||
    lower.includes("allocation failed") ||
    lower.includes("grow")
  ) {
    return "memory";
  }
  if (phase === "prelude") return "internal";
  return phase === "describe" ? "bad-describe" : "load-error";
};

const setLoader = (rt: QuickJSRuntime, job: SandboxJob): void => {
  const sources = new Map<string, string>();
  // 候補自身の名前は、部屋のモジュールより優先する。
  sources.set(`room:${job.name}`, job.code);
  for (const dep of job.deps) {
    if (!sources.has(`room:${dep.name}`)) sources.set(`room:${dep.name}`, dep.source);
  }
  rt.setModuleLoader(
    (moduleName) => {
      const source = sources.get(moduleName);
      return source === undefined ? { error: new Error("module not found") } : source;
    },
    // 第 1 引数は読み込み元、第 2 引数が要求された名前。`room:<名前>` はそのまま使う。
    (_baseModuleName, requestedName) => requestedName,
  );
};

const evalGlobal = (vm: QuickJSContext, scope: Scope, source: string, name: string): string | undefined => {
  const result = vm.evalCode(source, name, { type: "global" });
  if (result.error) return errorText(vm, scope, scope.manage(result.error));
  scope.manage(result.value);
  return undefined;
};

const createHelpers = (vm: QuickJSContext, scope: Scope): Helpers | undefined => {
  const result = vm.evalCode(HELPERS, "jamroom-helpers.js", { type: "global" });
  if (result.error) {
    scope.manage(result.error);
    return undefined;
  }
  return { encode: scope.manage(vm.getProp(scope.manage(result.value), "encode")) };
};

const settle = (
  vm: QuickJSContext,
  rt: QuickJSRuntime,
  scope: Scope,
  value: QuickJSHandle,
  expired: () => boolean,
): Attempt => {
  for (;;) {
    const state = vm.getPromiseState(value);
    if (state.type === "fulfilled") {
      return { failed: false, handle: state.notAPromise === true ? value : scope.manage(state.value) };
    }
    if (state.type === "rejected") {
      return { failed: true, message: errorText(vm, scope, scope.manage(state.error)) };
    }
    if (expired()) return { failed: true, message: "期限を過ぎた" };
    const jobs = rt.executePendingJobs(1);
    if (jobs.error) return { failed: true, message: errorText(vm, scope, scope.manage(jobs.error)) };
    if (jobs.value === 0) return { failed: true, message: "Promise が解決しない" };
  }
};

const encodeDescribe = (
  vm: QuickJSContext,
  scope: Scope,
  encode: QuickJSHandle,
  value: QuickJSHandle,
  isInterrupted: () => boolean,
): SandboxOutcome => {
  const limit = scope.manage(vm.newNumber(MAX_DESCRIBE_BYTES));
  const encoded = vm.callFunction(encode, vm.undefined, value, limit);
  if (encoded.error) {
    return classify("describe", isInterrupted(), errorText(vm, scope, scope.manage(encoded.error)));
  }
  const kindHandle = scope.manage(vm.getProp(scope.manage(encoded.value), "kind"));
  const ok = vm.typeof(kindHandle) === "string" && vm.getString(kindHandle) === "ok";
  return ok ? "ok" : "bad-describe";
};

const evaluate = (
  job: SandboxJob,
  vm: QuickJSContext,
  rt: QuickJSRuntime,
  scope: Scope,
  expired: () => boolean,
): Attempt => {
  const result = vm.evalCode(job.code, `room:${job.name}`, { type: "module" });
  if (result.error) return { failed: true, message: errorText(vm, scope, scope.manage(result.error)) };
  return settle(vm, rt, scope, scope.manage(result.value), expired);
};

export const runGuest = (job: SandboxJob, module: QuickJSWASMModule): SandboxOutcome => {
  const scope = new Scope();
  let phase: Phase = "prelude";
  let interrupted = false;
  try {
    const rt = scope.manage(module.newRuntime());
    rt.setMemoryLimit(GUEST_MEMORY_BYTES);
    rt.setMaxStackSize(GUEST_STACK_BYTES);
    const deadline = Date.now() + GUEST_DEADLINE_MS;
    const expired = (): boolean => {
      if (Date.now() >= deadline) {
        interrupted = true;
        return true;
      }
      return false;
    };
    rt.setInterruptHandler(expired);

    const vm = scope.manage(rt.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } }));
    setLoader(rt, job);

    const preludeError = evalGlobal(vm, scope, PRELUDE, "jamroom-prelude.js");
    if (preludeError !== undefined) return classify("prelude", interrupted, preludeError);
    const helpers = createHelpers(vm, scope);
    if (!helpers) return "internal";

    phase = "load";
    const loaded = evaluate(job, vm, rt, scope, expired);
    if (loaded.failed) return classify(phase, interrupted, loaded.message);

    phase = "describe";
    const describe = scope.manage(vm.getProp(loaded.handle, "describe"));
    if (vm.typeof(describe) !== "function") return "ok";
    const called = vm.callFunction(describe, vm.undefined);
    if (called.error) return classify(phase, interrupted, errorText(vm, scope, scope.manage(called.error)));
    return encodeDescribe(vm, scope, helpers.encode, scope.manage(called.value), () => interrupted);
  } catch (error) {
    return classify(phase, interrupted, String(error));
  } finally {
    try {
      scope.dispose();
    } catch {
      // 使い捨てなので、後片付けの失敗は結果に影響しない。
    }
  }
};

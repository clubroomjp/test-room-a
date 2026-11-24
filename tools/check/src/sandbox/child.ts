/**
 * 子プロセスの入口。2 つ目の床（見張り役）を持つ。
 *
 * QuickJS はワーカースレッドで動かし、この主スレッドが 25ms ごとに
 * 自分の RSS と経過時間を見る。超えたら符号を書いて自分を終了させる。
 * ゲストが WASM の中で固まっていても、主スレッドは動き続ける。
 */
import { Buffer } from "node:buffer";
import { Worker } from "node:worker_threads";
import { isRecord } from "../outcome.ts";
import { isSandboxOutcome, parseJob, MAX_JOB_BYTES, type SandboxJob, type SandboxOutcome } from "./job.ts";

const WATCH_INTERVAL_MS = 25;
/** 見張り役が止めるまで。ゲストの期限 1 秒に余裕を足した値。 */
const WATCH_DEADLINE_MS = 1500;
/** 起動直後の RSS から、これだけ増えたらメモリで止める。 */
const WATCH_ALLOWANCE_BYTES = 128 * 1024 * 1024;
const STDIN_CAP_BYTES = MAX_JOB_BYTES;
const EXIT_GRACE_MS = 500;

interface State {
  armed: boolean;
  finished: boolean;
  startedAt: number;
  baselineRssBytes: number;
}

const readStdin = async (): Promise<string | undefined> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > STDIN_CAP_BYTES) return undefined;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const writeReport = (outcome: SandboxOutcome): void => {
  process.stdout.write(`${JSON.stringify({ outcome })}\n`, () => process.exit(0));
  // 書き出しの callback が来ない環境でも、子が残らないようにする。
  setTimeout(() => process.exit(0), EXIT_GRACE_MS);
};

const tick = (state: State, stop: (outcome: SandboxOutcome) => void): void => {
  if (!state.armed || state.finished) return;
  const rssBytes = process.memoryUsage().rss;
  if (rssBytes > state.baselineRssBytes + WATCH_ALLOWANCE_BYTES) {
    stop("memory");
    return;
  }
  if (Date.now() - state.startedAt >= WATCH_DEADLINE_MS) {
    stop("timeout");
  }
};

const startWorker = (job: SandboxJob): Worker =>
  new Worker(new URL("./worker.ts", import.meta.url), {
    workerData: job,
    // ワーカーの出力は受け取らない（報告は postMessage だけ）。
    stdout: true,
    stderr: true,
  });

const main = async (): Promise<void> => {
  const text = await readStdin();
  if (text === undefined) {
    writeReport("internal");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    writeReport("internal");
    return;
  }
  const job = parseJob(parsed);
  if (!job) {
    writeReport("internal");
    return;
  }

  const state: State = {
    armed: false,
    finished: false,
    startedAt: Date.now(),
    baselineRssBytes: process.memoryUsage().rss,
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let worker: Worker | undefined;

  const stop = (outcome: SandboxOutcome): void => {
    if (state.finished) return;
    state.finished = true;
    if (timer !== undefined) clearInterval(timer);
    void worker?.terminate().catch(() => undefined);
    writeReport(outcome);
  };

  worker = startWorker(job);
  timer = setInterval(() => tick(state, stop), WATCH_INTERVAL_MS);

  worker.on("message", (message: unknown) => {
    if (!isRecord(message)) return;
    if (message["type"] === "ready") {
      // エンジンが載った直後を基準にする（起動の重さを混ぜない）。
      state.startedAt = Date.now();
      state.baselineRssBytes = process.memoryUsage().rss;
      state.armed = true;
      worker?.postMessage({ type: "go" });
      return;
    }
    if (message["type"] === "report") {
      const outcome = message["outcome"];
      stop(isSandboxOutcome(outcome) ? outcome : "internal");
    }
  });
  worker.on("error", () => stop("internal"));
  worker.on("exit", () => {
    if (!state.finished) stop("internal");
  });
};

await main();

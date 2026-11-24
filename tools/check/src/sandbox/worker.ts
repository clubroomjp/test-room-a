/**
 * ワーカースレッドの入口。QuickJS はこのスレッドの中だけで動く。
 * エンジンが載ったら "ready" を送り、主スレッドが "go" を返すまでゲストを動かさない。
 */
import { parentPort, workerData } from "node:worker_threads";
import { isRecord } from "../outcome.ts";
import { loadEngine } from "./engine.ts";
import { parseJob } from "./job.ts";
import { runGuest } from "./run.ts";

const post = (message: Record<string, unknown>): void => {
  parentPort?.postMessage(message);
};

const waitForGo = (): Promise<void> =>
  new Promise((resolve) => {
    if (!parentPort) {
      resolve();
      return;
    }
    parentPort.once("message", (message: unknown) => {
      if (isRecord(message) && message["type"] === "go") resolve();
    });
  });

const main = async (): Promise<void> => {
  const job = parseJob(workerData);
  if (!job) {
    post({ type: "report", outcome: "internal" });
    return;
  }
  let module: Awaited<ReturnType<typeof loadEngine>>;
  try {
    module = await loadEngine();
  } catch {
    post({ type: "report", outcome: "internal" });
    return;
  }
  post({ type: "ready" });
  await waitForGo();
  post({ type: "report", outcome: runGuest(job, module) });
};

void main();

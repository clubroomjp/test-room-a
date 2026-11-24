/**
 * 親側の床（3 つ目）。子プロセスを起動し、壁時計で必ず殺す。
 *
 * 子は Node の権限モデル付きで起動し、環境変数を一つも渡さない。
 * 子が返すのは符号だけであり、訪問者由来の文面は受け取らない。
 */
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_JOB_BYTES, parseReport, type SandboxJob, type SandboxOutcome } from "./job.ts";

/** 親が子を殺すまで。ゲストの期限 1 秒、見張り役 1.5 秒より後。 */
export const KILL_AFTER_MS = 3000;

const OUTPUT_CAP_BYTES = 64 * 1024;

/** payload/tools/check の根。 */
const toolsRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const childPath = (root: string): string => join(root, "src", "sandbox", "child.ts");

const commandFor = (root: string): readonly string[] => [
  process.execPath,
  "--permission",
  `--allow-fs-read=${root}`,
  "--allow-worker",
  childPath(root),
];

export const runSandbox = (job: SandboxJob): Promise<SandboxOutcome> =>
  new Promise((resolveOutcome) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: SandboxOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveOutcome(outcome);
    };

    const root = toolsRoot();
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(commandFor(root)[0] ?? process.execPath, commandFor(root).slice(1), {
        cwd: root,
        // 環境変数は渡さない。子は絶対パスだけで動く。
        env: {},
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resolveOutcome("internal");
      return;
    }

    let killed = false;
    let overflowed = false;
    let total = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const kill = (): void => {
      killed = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // すでに終わっている場合は何もしない。
      }
    };
    const collect = (chunks: Buffer[]) => (chunk: Buffer): void => {
      total += chunk.length;
      if (total > OUTPUT_CAP_BYTES) {
        overflowed = true;
        kill();
        return;
      }
      chunks.push(chunk);
    };

    timer = setTimeout(kill, KILL_AFTER_MS);
    child.stdout?.on("data", collect(stdout));
    child.stderr?.on("data", collect(stderr));
    child.on("error", () => finish("internal"));
    child.on("close", () => {
      if (overflowed) {
        finish("internal");
        return;
      }
      if (killed) {
        finish("timeout");
        return;
      }
      finish(parseReport(Buffer.concat(stdout).toString("utf8")) ?? "internal");
    });

    child.stdin?.on("error", () => undefined);
    try {
      const payload = `${JSON.stringify(job)}\n`;
      if (Buffer.byteLength(payload, "utf8") > MAX_JOB_BYTES) {
        finish("internal");
        return;
      }
      child.stdin?.end(payload);
    } catch {
      finish("internal");
    }
  });

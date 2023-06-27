/* eslint-disable no-console */
import childProcess from "node:child_process";
import stream from "node:stream";
import fs from "node:fs";
import path from "node:path";
import {sleep} from "@lodestar/utils";
import {TestContext} from "./interfaces.js";

/**
 * If timeout is greater than 0, the parent will send the signal
 * identified by the killSignal property (the default is 'SIGTERM')
 * if the child runs longer than timeout milliseconds.
 */
const defaultTimeout = 15 * 60 * 1000; // ms

export type ExecChildProcessOptions = {
  env?: Record<string, string>;
  pipeStdioToFile?: string;
  pipeStdioToParent?: boolean;
  logPrefix?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  signal?: AbortSignal;
};

/**
 * Run arbitrary commands in a shell
 * If the child process exits with code > 0, rejects
 */
export async function execChildProcess(cmd: string | string[], options?: ExecChildProcessOptions): Promise<string> {
  const {timeoutMs, maxBuffer, logPrefix, pipeStdioToParent, pipeStdioToFile} = options ?? {};
  const cmdStr = Array.isArray(cmd) ? cmd.join(" ") : cmd;

  return new Promise((resolve, reject) => {
    const proc = childProcess.exec(
      cmdStr,
      {timeout: timeoutMs ?? defaultTimeout, maxBuffer, env: {...process.env, ...options?.env}},
      (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout.trim());
        }
      }
    );

    const logPrefixStream = new stream.Transform({
      transform(chunk, _encoding, callback) {
        callback(null, `${logPrefix} ${proc.pid}: ${Buffer.from(chunk).toString("utf8")}`);
      },
    });

    if (pipeStdioToParent) {
      proc.stdout?.pipe(logPrefixStream).pipe(process.stdout);
      proc.stderr?.pipe(logPrefixStream).pipe(process.stderr);
    }

    if (pipeStdioToFile) {
      fs.mkdirSync(path.dirname(pipeStdioToFile), {recursive: true});
      const stdoutFileStream = fs.createWriteStream(pipeStdioToFile);

      proc.stdout?.pipe(logPrefixStream).pipe(stdoutFileStream);
      proc.stderr?.pipe(logPrefixStream).pipe(stdoutFileStream);

      proc.once("exit", (_code: number) => {
        stdoutFileStream.close();
      });
    }

    if (options?.signal) {
      options.signal.addEventListener(
        "abort",
        () => {
          proc.kill("SIGKILL");
        },
        {once: true}
      );
    }
  });
}

export const stopChildProcess = async (
  childProcess: childProcess.ChildProcess,
  signal: NodeJS.Signals | number = "SIGTERM"
): Promise<void> => {
  if (childProcess.killed || childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  return new Promise((resolve, reject) => {
    childProcess.once("error", reject);
    childProcess.once("close", resolve);
    childProcess.kill(signal);
  });
};

export enum ChildProcessResolve {
  Immediate,
  Completion,
  Healthy,
}

export type ChildProcessHealthStatus = {healthy: boolean; error?: string};

export type SpawnChildProcessOptions = {
  env?: Record<string, string>;
  pipeStdioToFile?: string;
  pipeStdioToParent?: boolean;
  logPrefix?: string;
  pipeOnlyError?: boolean;
  resolveOn?: ChildProcessResolve;
  healthTimeoutMs?: number;
  healthCheckIntervalMs?: number;
  logHealthChecksAfterMs?: number;
  testContext?: TestContext;
  signal?: AbortSignal;
  // If health attribute defined we will consider resolveOn = ChildProcessResolve.Healthy
  health?: () => Promise<{healthy: boolean; error?: string}>;
};

const defaultStartOpts = {
  env: {},
  pipeStdToParent: false,
  pipeOnlyError: false,
  logPrefix: "",
  healthCheckIntervalMs: 1000,
  logHealthChecksAfterMs: 2000,
  resolveOn: ChildProcessResolve.Immediate,
};

export async function spawnChildProcess(
  command: string,
  args: string[],
  opts?: Partial<SpawnChildProcessOptions>
): Promise<childProcess.ChildProcessWithoutNullStreams> {
  const options = {...defaultStartOpts, ...opts};
  const {env, pipeStdioToFile, pipeStdioToParent, logPrefix, pipeOnlyError, signal} = options;
  const {health, resolveOn, healthCheckIntervalMs, logHealthChecksAfterMs, healthTimeoutMs, testContext} = options;

  return new Promise<childProcess.ChildProcessWithoutNullStreams>((resolve, reject) => {
    void (async () => {
      const proc = childProcess.spawn(command, args, {
        env: {...process.env, ...env},
      });

      const logPrefixStream = new stream.Transform({
        transform(chunk, _encoding, callback) {
          callback(null, `[${logPrefix}] [${proc.pid}]: ${Buffer.from(chunk).toString("utf8")}`);
        },
      });

      if (testContext) {
        testContext.afterEach(async () => {
          proc.kill("SIGINT");
          await sleep(1000, signal);
          await stopChildProcess(proc);
        });
      }

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            proc.kill("SIGKILL");
          },
          {once: true}
        );
      }

      if (pipeStdioToFile) {
        fs.mkdirSync(path.dirname(pipeStdioToFile), {recursive: true});
        const stdoutFileStream = fs.createWriteStream(pipeStdioToFile);

        proc.stdout.pipe(logPrefixStream).pipe(stdoutFileStream);
        proc.stderr.pipe(logPrefixStream).pipe(stdoutFileStream);

        proc.once("exit", (_code: number) => {
          stdoutFileStream.close();
        });
      }

      if (pipeStdioToParent) {
        proc.stdout.pipe(logPrefixStream).pipe(process.stdout);
        proc.stderr.pipe(logPrefixStream).pipe(process.stderr);
      }

      if (!pipeStdioToParent && pipeOnlyError) {
        // If want to see only errors then show it on the output stream of main process
        proc.stderr.pipe(logPrefixStream).pipe(process.stdout);
      }

      // If there is any error in running the child process, reject the promise
      proc.on("error", reject);

      if (!health && resolveOn === ChildProcessResolve.Immediate) {
        return resolve(proc);
      }

      if (!health && resolveOn === ChildProcessResolve.Completion) {
        proc.once("exit", (code: number) => {
          if (code > 0) {
            reject(new Error(`process exited. pid=${proc.pid}, code=${code}, command="${command} ${args.join(" ")}"`));
          } else {
            resolve(proc);
          }
        });

        return;
      }

      // If there is a health check, wait for it to pass
      if (health) {
        const startHealthCheckMs = Date.now();
        const intervalId = setInterval(() => {
          health()
            .then((isHealthy) => {
              if (isHealthy.healthy) {
                clearInterval(intervalId);
                clearTimeout(healthTimeoutId);
                proc.removeAllListeners("exit");
                resolve(proc);
              } else {
                const timeSinceHealthCheckStart = Date.now() - startHealthCheckMs;
                if (timeSinceHealthCheckStart > logHealthChecksAfterMs) {
                  console.log(
                    `Health check unsuccessful. logPrefix=${logPrefix} pid=${proc.pid}  timeSinceHealthCheckStart=${timeSinceHealthCheckStart}`
                  );
                }
              }
            })
            .catch((e) => {
              console.error("error on health check, health functions must never throw", e);
            });
        }, healthCheckIntervalMs);

        const healthTimeoutId = setTimeout(() => {
          clearTimeout(healthTimeoutId);

          if (intervalId !== undefined) {
            reject(
              new Error(
                `Health check timeout. logPrefix=${logPrefix} pid=${proc.pid}  healthTimeoutMs=${healthTimeoutMs}`
              )
            );
          }
        }, healthTimeoutMs);

        proc.once("exit", (code: number) => {
          if (healthTimeoutId !== undefined) return;

          clearInterval(intervalId);
          clearTimeout(healthTimeoutId);

          reject(
            new Error(
              `process exited before healthy. logPrefix=${logPrefix} pid=${
                proc.pid
              } healthTimeoutMs=${healthTimeoutMs} code=${code} command="${command} ${args.join(" ")}"`
            )
          );
        });
      }
    })();
  });
}

export function bufferStderr(proc: childProcess.ChildProcessWithoutNullStreams): {read: () => string} {
  let data = "";
  proc.stderr.on("data", (chunk) => {
    data += Buffer.from(chunk).toString("utf8");
  });

  return {
    read: () => data,
  };
}

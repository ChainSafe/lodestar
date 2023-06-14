/* eslint-disable no-console */
import childProcess from "node:child_process";
import stream from "node:stream";
import fs from "node:fs";
import path from "node:path";

/**
 * If timeout is greater than 0, the parent will send the signal
 * identified by the killSignal property (the default is 'SIGTERM')
 * if the child runs longer than timeout milliseconds.
 */
const defaultTimeout = 15 * 60 * 1000; // ms

export type ShellOpts = {
  timeoutMs?: number;
  maxBuffer?: number;
  signal?: AbortSignal;
  pipeStdToParent?: boolean;
};

/**
 * Run arbitrary commands in a shell
 * If the child process exits with code > 0, rejects
 */
export async function execChildProcess(cmd: string | string[], options?: ShellOpts): Promise<string> {
  const timeout = options?.timeoutMs ?? defaultTimeout;
  const maxBuffer = options?.maxBuffer;
  const cmdStr = Array.isArray(cmd) ? cmd.join(" ") : cmd;

  return new Promise((resolve, reject) => {
    const proc = childProcess.exec(cmdStr, {timeout, maxBuffer}, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout.trim());
      }
    });

    if (options?.pipeStdToParent) {
      proc.stdout?.pipe(process.stdout);
      proc.stderr?.pipe(process.stderr);
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

enum ChildProcessResolve {
  Immediate,
  Completion,
  Healthy,
}

type StartChildProcessOptions = {
  env: Record<string, string>;
  pipeStdToFile: string | undefined;
  pipeStdToParent: boolean;
  logPrefix: string;
  pipeOnlyError: boolean;
  resolveOn: ChildProcessResolve;
  healthTimeoutMs: number | undefined;
  healthCheckIntervalMs: number;
  logHealthChecksAfterMs: number;
  signal: AbortSignal | undefined;
  // If health attribute defined we will consider resolveOn = ChildProcessResolve.Healthy
  health?: () => Promise<{healthy: boolean; error?: string}>;
};

const defaultStartOpts: StartChildProcessOptions = {
  env: {},
  pipeStdToParent: false,
  pipeOnlyError: false,
  logPrefix: "",
  healthTimeoutMs: undefined,
  healthCheckIntervalMs: 1000,
  logHealthChecksAfterMs: 2000,
  resolveOn: ChildProcessResolve.Immediate,
  pipeStdToFile: undefined,
  signal: undefined,
  health: undefined,
};

export async function spawnChildProcess(
  command: string,
  args: string[],
  opts?: Partial<StartChildProcessOptions>
): Promise<childProcess.ChildProcess> {
  const {
    env,
    pipeStdToFile,
    pipeStdToParent,
    logPrefix,
    pipeOnlyError,
    health,
    resolveOn,
    healthCheckIntervalMs,
    logHealthChecksAfterMs,
    healthTimeoutMs,
    signal,
  }: StartChildProcessOptions = {
    ...defaultStartOpts,
    ...opts,
  };

  return new Promise<childProcess.ChildProcess>((resolve, reject) => {
    void (async () => {
      const proc = childProcess.spawn(command, args, {
        env: {...process.env, ...env},
      });

      const logPrefixStream = new stream.Transform({
        transform(chunk, _encoding, callback) {
          callback(null, `${logPrefix} ${proc.pid}: ${Buffer.from(chunk).toString("utf8")}`);
        },
      });

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            proc.kill("SIGKILL");
          },
          {once: true}
        );
      }

      if (pipeStdToFile) {
        fs.mkdirSync(path.dirname(pipeStdToFile), {recursive: true});
        const stdoutFileStream = fs.createWriteStream(pipeStdToFile);

        proc.stdout.pipe(logPrefixStream).pipe(stdoutFileStream);
        proc.stderr.pipe(logPrefixStream).pipe(stdoutFileStream);

        proc.once("exit", (_code: number) => {
          stdoutFileStream.close();
        });
      }

      if (pipeStdToParent) {
        proc.stdout.pipe(logPrefixStream).pipe(process.stdout);
        proc.stderr.pipe(logPrefixStream).pipe(process.stderr);
      }

      if (!pipeStdToParent && pipeOnlyError) {
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
                  console.log(`Health check unsuccessful pid='${proc.pid}' after ${timeSinceHealthCheckStart} ms`);
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
            reject(new Error(`Health check timeout pid='${proc.pid}' after ${healthTimeoutMs} ms`));
          }
        }, healthTimeoutMs);

        proc.once("exit", (code: number) => {
          clearInterval(intervalId);
          clearTimeout(healthTimeoutId);
          reject(
            new Error(
              `process exited before healthy. pid=${proc.pid}, code=${code}, command="${command} ${args.join(" ")}"`
            )
          );
        });
      }
    })();
  });
}

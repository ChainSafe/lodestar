/* eslint-disable no-console */
import childProcess from "node:child_process";
import stream from "node:stream";
import fs from "node:fs";
import path from "node:path";
import {prettyMsToTime, sleep} from "@lodestar/utils";
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

/**
 * Check if process with given pid is running
 */
export function isPidRunning(pid: number): boolean {
  try {
    // Signal 0 is a special signal that checks if the process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const stopChildProcess = async (
  childProcess: childProcess.ChildProcess,
  signal: NodeJS.Signals | number = "SIGTERM"
): Promise<void> => {
  if (childProcess.killed || childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  const pid = childProcess.pid;

  await new Promise((resolve, reject) => {
    childProcess.once("error", reject);
    // We use `exit` instead of `close` as multiple processes can share same `stdio`
    childProcess.once("exit", resolve);
    childProcess.kill(signal);
  });

  if (pid != null && isPidRunning(pid)) {
    // Wait for sometime and try to kill this time
    await sleep(500);
    await stopChildProcess(childProcess, "SIGKILL");
  }
};

/**
 * Gracefully stop child process by sending SIGINT signal
 *
 * @param childProcess - child process to gracefully stop
 * @param timeoutMs - timeout to wait for child process to exit before killing
 * @returns
 */
export const gracefullyStopChildProcess = async (
  childProcess: childProcess.ChildProcess,
  timeoutMs = 3000
): Promise<void> => {
  if (childProcess.killed || childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  // Send signal to child process to gracefully stop
  childProcess.kill("SIGINT");

  // Wait for process to exit or timeout
  const result = await Promise.race([
    new Promise((resolve) => childProcess.once("exit", resolve)).then(() => "exited"),
    sleep(timeoutMs).then(() => "timeout"),
  ]);

  // If process is timeout kill it
  if (result === "timeout") {
    await stopChildProcess(childProcess, "SIGKILL");
  }
};

export enum ChildProcessResolve {
  /**
   * Resolve immediately after spawning child process
   */
  Immediate,
  /**
   * Resolve after child process exits
   */
  Completion,
  /**
   * Resolve after child process is healthy. Only considered when `heath` attr is set
   */
  Healthy,
}

export type ChildProcessHealthStatus = {healthy: boolean; error?: string};

export type SpawnChildProcessOptions = {
  /**
   * Environment variables to pass to child process
   */
  env?: Record<string, string>;
  /**
   * If true, pipe child process stdio to parent process
   */
  pipeStdioToFile?: string;
  /**
   * If true, pipe child process stdio to parent process
   */
  pipeStdioToParent?: boolean;
  /**
   * The prefix to add to child process stdio to identify it from logs
   */
  logPrefix?: string;
  /**
   * Hide stdio from parent process and only show errors
   */
  pipeOnlyError?: boolean;
  /**
   * Child process resolve behavior
   */
  resolveOn?: ChildProcessResolve;
  /**
   * Timeout to wait for child process before considering it unhealthy
   */
  healthTimeoutMs?: number;
  /**
   * Interval to check child process health
   */
  healthCheckIntervalMs?: number;
  /**
   * Log health checks after this time
   */
  logHealthChecksAfterMs?: number;
  /**
   * Test context to pass to child process. Useful for testing to close the process after test case
   */
  testContext?: TestContext;
  /**
   * Abort signal to stop child process
   */
  signal?: AbortSignal;
  /**
   * If health attribute defined we will consider resolveOn = ChildProcessResolve.Healthy
   */
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

/**
 * Spawn child process and return it
 *
 * @param command - command to run in child process relative to mono-repo root
 * @param args - command arguments
 * @param opts - options
 * @returns
 */
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

      const getLogPrefixStream = (): stream.Transform =>
        new stream.Transform({
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

        proc.stdout.pipe(getLogPrefixStream()).pipe(stdoutFileStream);
        proc.stderr.pipe(getLogPrefixStream()).pipe(stdoutFileStream);

        proc.once("exit", (_code: number) => {
          stdoutFileStream.close();
        });
      }

      if (pipeStdioToParent) {
        proc.stdout.pipe(getLogPrefixStream()).pipe(process.stdout);
        proc.stderr.pipe(getLogPrefixStream()).pipe(process.stderr);
      }

      if (!pipeStdioToParent && pipeOnlyError) {
        // If want to see only errors then show it on the output stream of main process
        proc.stderr.pipe(getLogPrefixStream()).pipe(process.stdout);
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
                    `Health check unsuccessful. logPrefix=${logPrefix} pid=${
                      proc.pid
                    } timeSinceHealthCheckStart=${prettyMsToTime(timeSinceHealthCheckStart)}`
                  );
                }
              }
            })
            .catch((e) => {
              console.error("Error on health check, health functions must never throw", e);
            });
        }, healthCheckIntervalMs);

        const healthTimeoutId = setTimeout(() => {
          clearTimeout(healthTimeoutId);

          if (intervalId !== undefined) {
            reject(
              new Error(
                `Health check timeout. logPrefix=${logPrefix} pid=${proc.pid} healthTimeout=${prettyMsToTime(
                  healthTimeoutMs ?? 0
                )}`
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
              `Process exited before healthy. logPrefix=${logPrefix} pid=${proc.pid} healthTimeout=${prettyMsToTime(
                healthTimeoutMs ?? 0
              )} code=${code} command="${command} ${args.join(" ")}"`
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

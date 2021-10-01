import childProcess from "child_process";
import {AbortSignal} from "@chainsafe/abort-controller";

/**
 * If timeout is greater than 0, the parent will send the signal
 * identified by the killSignal property (the default is 'SIGTERM')
 * if the child runs longer than timeout milliseconds.
 */
const defaultTimeout = 15 * 60 * 1000; // ms

/**
 * Run arbitrary commands in a shell
 * If the child process exits with code > 0, rejects
 */
export async function shell(
  cmd: string | string[],
  options?: {timeout?: number; maxBuffer?: number; signal?: AbortSignal}
): Promise<string> {
  const timeout = options?.timeout || defaultTimeout;
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

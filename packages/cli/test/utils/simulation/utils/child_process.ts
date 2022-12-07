import {ChildProcess, spawn} from "node:child_process";
import {createWriteStream, mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {JobOptions} from "../interfaces.js";

const childProcessHealthCheckInterval = 1000;
const logHealthChecksAfterMs = 2000;

/* eslint-disable no-console */

export const stopChildProcess = async (
  childProcess: ChildProcess,
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

export const startChildProcess = async (jobOptions: JobOptions): Promise<ChildProcess> => {
  return new Promise<ChildProcess>((resolve, reject) => {
    const childProcess = spawn(jobOptions.cli.command, jobOptions.cli.args, {
      env: {...process.env, ...jobOptions.cli.env},
    });

    mkdirSync(dirname(jobOptions.logs.stdoutFilePath), {recursive: true});
    const stdoutFileStream = createWriteStream(jobOptions.logs.stdoutFilePath);
    childProcess.stdout?.pipe(stdoutFileStream);
    childProcess.stderr?.pipe(stdoutFileStream);

    // If there is any error in running the child process, reject the promise
    childProcess.on("error", reject);

    // If there is a health check, wait for it to pass
    const health = jobOptions.health;

    if (health) {
      const startHealthCheckMs = Date.now();
      const intervalId = setInterval(() => {
        health()
          .then((isHealthy) => {
            if (isHealthy) {
              clearInterval(intervalId);
              childProcess.removeAllListeners("exit");
              resolve(childProcess);
            } else {
              const timeSinceHealthCheckStart = Date.now() - startHealthCheckMs;
              if (timeSinceHealthCheckStart > logHealthChecksAfterMs) {
                console.log(`Health check unsuccessful '${jobOptions.id}' after ${timeSinceHealthCheckStart} ms`);
              }
            }
          })
          .catch((e) => {
            console.error("error on health check, health functions must never throw", e);
          });
      }, childProcessHealthCheckInterval);

      childProcess.once("exit", (code: number) => {
        clearInterval(intervalId);
        stdoutFileStream.close();
        reject(
          new Error(`process exited with code ${code}. ${jobOptions.cli.command} ${jobOptions.cli.args.join(" ")}`)
        );
      });
    }

    // If there is no health check, resolve/reject on completion
    else {
      childProcess.once("exit", (code: number) => {
        stdoutFileStream.close();
        if (code > 0) {
          reject(
            new Error(`$process exited with code ${code}. ${jobOptions.cli.command} ${jobOptions.cli.args.join(" ")}`)
          );
        } else {
          resolve(childProcess);
        }
      });
    }
  });
};

export function resolveNestedJobOptions(jobsNested: JobOptions[]): JobOptions[] {
  const jobs: JobOptions[] = [];

  for (const job of jobsNested) {
    jobs.push(job);
    if (job.children) {
      jobs.push(...resolveNestedJobOptions(job.children));
    }
  }

  return jobs;
}

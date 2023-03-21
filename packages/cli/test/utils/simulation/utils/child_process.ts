/* eslint-disable no-console */
import {ChildProcess, spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {JobOptions, RunnerType} from "../interfaces.js";

const healthCheckIntervalMs = 1000;
const logHealthChecksAfterMs = 2000;

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

export const startChildProcess = async (
  jobOptions: Pick<JobOptions<RunnerType.ChildProcess>, "cli" | "logs" | "id" | "health">
): Promise<ChildProcess> => {
  return new Promise<ChildProcess>((resolve, reject) => {
    void (async () => {
      const childProcess = spawn(jobOptions.cli.command, jobOptions.cli.args, {
        env: {...process.env, ...jobOptions.cli.env},
      });

      fs.mkdirSync(path.dirname(jobOptions.logs.stdoutFilePath), {recursive: true});
      const stdoutFileStream = fs.createWriteStream(jobOptions.logs.stdoutFilePath);
      childProcess.stdout?.pipe(stdoutFileStream);
      childProcess.stderr?.pipe(stdoutFileStream);

      // If there is any error in running the child process, reject the promise
      childProcess.on("error", reject);

      // If there is a health check, wait for it to pass
      const health = jobOptions.health;

      // If there is a health check, wait for it to pass
      if (health) {
        const startHealthCheckMs = Date.now();
        const intervalId = setInterval(() => {
          health()
            .then((isHealthy) => {
              if (isHealthy.ok) {
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
        }, healthCheckIntervalMs);

        childProcess.once("exit", (code: number) => {
          clearInterval(intervalId);
          stdoutFileStream.close();
          reject(
            new Error(
              `process exited. job=${jobOptions.id}, code=${code}, command="${
                jobOptions.cli.command
              } ${jobOptions.cli.args.join(" ")}"`
            )
          );
        });
      } else {
        // If there is no health check, resolve/reject on completion
        childProcess.once("exit", (code: number) => {
          stdoutFileStream.close();
          if (code > 0) {
            reject(
              new Error(
                `process exited. job=${jobOptions.id}, code=${code}, command="${
                  jobOptions.cli.command
                } ${jobOptions.cli.args.join(" ")}"`
              )
            );
          } else {
            resolve(childProcess);
          }
        });
      }
    })();
  });
};

/* eslint-disable no-console */
import {ChildProcess, spawn} from "node:child_process";
import {createWriteStream, mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {ChildProcessWithJobOptions, JobOptions} from "../interfaces.js";

const childProcessHealthCheckInterval = 1000;
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

export const startChildProcess = async (jobOptions: JobOptions): Promise<ChildProcess> => {
  return new Promise<ChildProcess>((resolve, reject) => {
    void (async () => {
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
        }, childProcessHealthCheckInterval);

        childProcess.once("exit", (code: number) => {
          clearInterval(intervalId);
          stdoutFileStream.close();
          reject(
            new Error(`process exited with code ${code}. ${jobOptions.cli.command} ${jobOptions.cli.args.join(" ")}`)
          );
        });
      } else {
        // If there is no health check, resolve/reject on completion
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
    })();
  });
};

export const startJobs = async (jobs: JobOptions[]): Promise<ChildProcessWithJobOptions[]> => {
  const childProcesses: ChildProcessWithJobOptions[] = [];
  for (const job of jobs) {
    if (job.bootstrap) {
      console.log(`DockerRunner bootstraping '${job.id}'...`);
      await job.bootstrap();
      console.log(`DockerRunner bootstraped '${job.id}'`);
    }
    console.log(`DockerRunner starting '${job.id}'...`);
    childProcesses.push({childProcess: await startChildProcess(job), jobOptions: job});
    console.log(`DockerRunner started '${job.id}'`);

    if (job.children) {
      childProcesses.push(...(await startJobs(job.children)));
    }
  }

  return childProcesses;
};

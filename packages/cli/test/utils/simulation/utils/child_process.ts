import {ChildProcess, spawn} from "node:child_process";
import {createWriteStream, mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {ChildProcessWithJobOptions, JobOptions} from "../interfaces.js";

const childProcessHealthCheckInterval = 1000;

export const stopChildProcess = async (
  childProcess: ChildProcess,
  signal: NodeJS.Signals | number = "SIGTERM"
): Promise<void> => {
  if (childProcess.killed || childProcess.exitCode !== null || childProcess.signalCode !== undefined) {
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
      if (jobOptions.health) {
        const intervalId = setInterval(async () => {
          if (jobOptions.health && (await jobOptions.health())) {
            clearInterval(intervalId);
            childProcess.removeAllListeners("exit");
            resolve(childProcess);
          }
        }, childProcessHealthCheckInterval);

        childProcess.once("exit", (code: number) => {
          clearInterval(intervalId);
          stdoutFileStream.close();
          reject(
            new Error(`process exited with code ${code}. ${jobOptions.cli.command} ${jobOptions.cli.args.join(" ")}`)
          );
        });

        return;
      }

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
    })();
  });
};

export const startJobs = async (jobs: JobOptions[]): Promise<ChildProcessWithJobOptions[]> => {
  const childProcesses: ChildProcessWithJobOptions[] = [];
  for (const job of jobs) {
    if (job.bootstrap) {
      await job.bootstrap();
    }
    childProcesses.push({childProcess: await startChildProcess(job), jobOptions: job});

    if (job.children) {
      childProcesses.push(...(await startJobs(job.children)));
    }
  }

  return childProcesses;
};

import {ChildProcess, spawn} from "node:child_process";
import {createWriteStream, mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {EventEmitter} from "node:events";
import {JobOptions, Job, Runner, RunnerEvent, RunnerType} from "../interfaces.js";

type ChildProcessWithJobOptions = {jobOptions: JobOptions; childProcess: ChildProcess};

const stopChildProcess = async (childProcess: ChildProcess, signal?: "SIGTERM"): Promise<void> => {
  return new Promise((resolve) => {
    childProcess.on("close", resolve);
    childProcess.kill(signal);
  });
};

const startChildProcess = async (jobOptions: JobOptions): Promise<ChildProcess> => {
  return new Promise<ChildProcess>((resolve, reject) => {
    void (async () => {
      const childProcess = spawn(jobOptions.cli.command, jobOptions.cli.args, {
        env: {...process.env, ...jobOptions.cli.env},
      });

      mkdirSync(dirname(jobOptions.logs.stdoutFilePath), {recursive: true});
      const stdoutFileStream = createWriteStream(jobOptions.logs.stdoutFilePath);

      childProcess.stdout?.pipe(stdoutFileStream);
      childProcess.stderr?.pipe(stdoutFileStream);

      childProcess.on("error", reject);
      childProcess.on("exit", (code: number) => {
        clearInterval(intervalId);
        stdoutFileStream.close();
        reject(new Error(`process exited with code ${code}`));
      });

      const intervalId = setInterval(async () => {
        if (await jobOptions.health()) {
          clearInterval(intervalId);
          resolve(childProcess);
        }
      }, 1000);
    })();
  });
};

const startJobs = async (jobs: JobOptions[]): Promise<ChildProcessWithJobOptions[]> => {
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

export class ChildProcessRunner implements Runner {
  type = RunnerType.ChildProcess;

  private emitter = new EventEmitter({captureRejections: true});

  on(event: RunnerEvent, cb: () => void | Promise<void>): void {
    this.emitter.on(event, cb);
  }

  create(id: string, jobs: JobOptions[]): Job {
    const childProcesses: ChildProcessWithJobOptions[] = [];

    const stop = async (): Promise<void> => {
      // eslint-disable-next-line no-console
      console.log(`Stopping "${id}"...`);
      this.emitter.emit("stopping");
      for (const {jobOptions, childProcess} of childProcesses) {
        if (jobOptions.cleanup) {
          await jobOptions.cleanup();
        }
        await stopChildProcess(childProcess);
      }

      // eslint-disable-next-line no-console
      console.log(`Stopped "${id}"...`);
      this.emitter.emit("stopped");
    };

    const start = (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        void (async () => {
          try {
            // eslint-disable-next-line no-console
            console.log(`Starting "${id}"...`);
            this.emitter.emit("starting");
            childProcesses.push(...(await startJobs(jobs)));
            // eslint-disable-next-line no-console
            console.log(`Started "${id}"...`);
            this.emitter.emit("started");
            resolve();
          } catch (err) {
            reject(err);
          }
        })();
      });

    return {id, start, stop, type: this.type};
  }
}

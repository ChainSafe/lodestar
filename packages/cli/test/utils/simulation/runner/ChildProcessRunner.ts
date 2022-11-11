import {EventEmitter} from "node:events";
import {ChildProcessWithJobOptions, Job, JobOptions, Runner, RunnerEvent, RunnerType} from "../interfaces.js";
import {startJobs, stopChildProcess} from "../utils/child_process.js";

export class ChildProcessRunner implements Runner<RunnerType.ChildProcess> {
  type = RunnerType.ChildProcess as const;

  private emitter = new EventEmitter({captureRejections: true});

  on(event: RunnerEvent, cb: () => void | Promise<void>): void {
    this.emitter.on(event, cb);
  }

  create(id: string, jobOptions: JobOptions[]): Job {
    const childProcesses: ChildProcessWithJobOptions[] = [];

    const stop = async (): Promise<void> => {
      // eslint-disable-next-line no-console
      console.log(`Stopping "${id}"...`);
      this.emitter.emit("stopping");
      for (const {jobOptions, childProcess} of childProcesses) {
        if (jobOptions.teardown) {
          await jobOptions.teardown();
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
            childProcesses.push(...(await startJobs(jobOptions)));
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

import {EventEmitter} from "node:events";
import {ChildProcessWithJobOptions, Job, JobOptions, Runner, RunnerEvent, RunnerType} from "../interfaces.js";
import {resolveNestedJobOptions, startChildProcess, stopChildProcess} from "../utils/child_process.js";

/* eslint-disable no-console */

export class ChildProcessRunner implements Runner<RunnerType.ChildProcess> {
  type = RunnerType.ChildProcess as const;

  private emitter = new EventEmitter({captureRejections: true});

  on(event: RunnerEvent, cb: () => void | Promise<void>): void {
    this.emitter.on(event, cb);
  }

  create(id: string, jobOptionsArr: JobOptions[]): Job {
    const childProcesses: ChildProcessWithJobOptions[] = [];

    const stop = async (): Promise<void> => {
      // TODO FOR NAZAR: Why are this events necessary?
      this.emitter.emit("stopping");
      for (const {jobOptions, childProcess} of childProcesses) {
        console.log(`ChildProcessRunner stopping '${jobOptions.id}'...`);
        if (jobOptions.teardown) {
          await jobOptions.teardown();
        }
        await stopChildProcess(childProcess);
        console.log(`ChildProcessRunner stopped '${jobOptions.id}'`);
      }

      // eslint-disable-next-line no-console

      this.emitter.emit("stopped");
    };

    const start = async (): Promise<void> => {
      const jobOptions = resolveNestedJobOptions(jobOptionsArr);

      for (const job of jobOptions) {
        if (job.bootstrap) {
          console.log(`ChildProcessRunner bootstraping '${job.id}'...`);
          await job.bootstrap();
          console.log(`ChildProcessRunner bootstraped '${job.id}'`);
        }

        console.log(`ChildProcessRunner starting '${job.id}'...`);
        childProcesses.push({
          childProcess: await startChildProcess(job),
          jobOptions: job,
        });
        console.log(`ChildProcessRunner started '${job.id}'`);
      }
    };

    return {id, start, stop, type: this.type};
  }
}

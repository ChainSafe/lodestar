import {ChildProcess} from "node:child_process";
import {Job, JobOptions, RunnerEnv, RunnerType} from "../interfaces.js";
import {startChildProcess, stopChildProcess} from "../utils/child_process.js";

export class ChildProcessRunner implements RunnerEnv<RunnerType.ChildProcess> {
  type = RunnerType.ChildProcess as const;

  create(jobOption: Omit<JobOptions<RunnerType.ChildProcess>, "children">): Job {
    let childProcess: ChildProcess;

    return {
      id: jobOption.id,
      start: async () => {
        childProcess = await startChildProcess(jobOption);
      },
      stop: async () => {
        if (childProcess === undefined) {
          return;
        }
        await stopChildProcess(childProcess);
      },
    };
  }
}

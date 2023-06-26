import {ChildProcess} from "node:child_process";
import {
  spawnChildProcess,
  stopChildProcess,
  ChildProcessHealthStatus,
  SpawnChildProcessOptions,
} from "@lodestar/test-util";
import {Job, JobOptions, RunnerEnv, RunnerType} from "../interfaces.js";

export class ChildProcessRunner implements RunnerEnv<RunnerType.ChildProcess> {
  type = RunnerType.ChildProcess as const;

  create(jobOption: Omit<JobOptions<RunnerType.ChildProcess>, "children">): Job {
    let childProcess: ChildProcess;

    const spawnOpts: SpawnChildProcessOptions = {
      env: jobOption.cli.env,
      pipeStdioToFile: jobOption.logs.stdoutFilePath,
      logPrefix: jobOption.id,
    };

    const health = jobOption.health;

    if (health) {
      spawnOpts.health = async (): Promise<ChildProcessHealthStatus> =>
        health()
          .then((status) => {
            return status.ok ? {healthy: true} : {healthy: false};
          })
          .catch((error) => {
            return {healthy: false, message: (error as Error).message};
          });
    }

    return {
      id: jobOption.id,
      start: async () => {
        childProcess = await spawnChildProcess(jobOption.cli.command, jobOption.cli.args, spawnOpts);
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

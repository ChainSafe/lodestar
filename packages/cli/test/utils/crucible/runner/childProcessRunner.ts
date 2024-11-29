import {ChildProcess} from "node:child_process";
import {Logger} from "@lodestar/logger";
import {ChildProcessResolve, SpawnChildProcessOptions, spawnChildProcess, stopChildProcess} from "@lodestar/test-utils";
import {Job, JobOptions, RunnerEnv, RunnerType} from "../interfaces.js";

export class ChildProcessRunner implements RunnerEnv<RunnerType.ChildProcess> {
  type = RunnerType.ChildProcess as const;
  private logger: Logger;

  constructor(opts: {logger: Logger}) {
    this.logger = opts.logger;
  }

  create(jobOption: Omit<JobOptions<RunnerType.ChildProcess>, "children">): Job {
    let childProcess: ChildProcess;

    const spawnOpts: SpawnChildProcessOptions = {
      env: jobOption.cli.env,
      pipeStdioToFile: jobOption.logs.stdoutFilePath,
      logPrefix: jobOption.id,
    };

    const health = jobOption.health;

    if (health) {
      spawnOpts.healthTimeoutMs = 30000;
      spawnOpts.health = health;
    } else {
      spawnOpts.resolveOn = ChildProcessResolve.Completion;
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

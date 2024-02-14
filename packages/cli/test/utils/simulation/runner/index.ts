import {EventEmitter} from "node:events";
import path from "node:path";
import {Logger} from "@lodestar/logger";
import {IRunner, Job, JobOptions, RunnerEvent, RunnerType} from "../interfaces.js";
import {ChildProcessRunner} from "./ChildProcessRunner.js";
import {DockerRunner} from "./DockerRunner.js";

export class Runner implements IRunner {
  readonly logger: Logger;
  private emitter = new EventEmitter({captureRejections: true});
  private runners: {[RunnerType.ChildProcess]: ChildProcessRunner; [RunnerType.Docker]: DockerRunner};

  constructor({logsDir, logger}: {logsDir: string; logger: Logger}) {
    this.logger = logger;
    this.runners = {
      [RunnerType.ChildProcess]: new ChildProcessRunner(),
      [RunnerType.Docker]: new DockerRunner(path.join(logsDir, "docker_runner.log")),
    };
  }

  on(event: RunnerEvent, cb: (id: string) => void | Promise<void>): void {
    this.emitter.on(event, cb);
  }

  getNextIp(): string {
    return this.runners[RunnerType.Docker].getNextIp();
  }

  async start(): Promise<void> {
    await this.runners[RunnerType.Docker].start();
  }

  async stop(): Promise<void> {
    await this.runners[RunnerType.Docker].stop();
  }

  create(jobOptions: JobOptions[]): Job {
    return this._create(jobOptions);
  }

  private _create(jobOptions: JobOptions[]): Job {
    const startSequence: Array<() => Promise<void>> = [];
    const stopSequence: Array<() => Promise<void>> = [];

    for (const jobOption of jobOptions) {
      if (!(jobOption.type in this.runners)) {
        throw new Error(`Unknown job type: ${jobOption.type}`);
      }

      // TODO: Debug the type issue
      const job = this.runners[jobOption.type].create(jobOption as any);
      const childrenJob = jobOption.children ? this._create(jobOption.children) : null;

      startSequence.push(async () => {
        this.emitter.emit("starting", jobOption.id);
        this.logger.info(`Starting "${jobOption.id}"...`);

        if (jobOption.bootstrap) await jobOption.bootstrap();
        await job.start();

        this.emitter.emit("started", jobOption.id);
        this.logger.info(`Started "${jobOption.id}" logFile=${jobOption.logs.stdoutFilePath}...`);

        if (childrenJob) await childrenJob.start();
      });

      stopSequence.push(async () => {
        this.emitter.emit("stopping", jobOption.id);
        this.logger.info(`Stopping "${jobOption.id}"...`);
        if (jobOption.teardown) await jobOption.teardown();
        if (childrenJob) await childrenJob.stop();
        await job.stop();
        this.emitter.emit("stopped", jobOption.id);
        this.logger.info(`Stopped "${jobOption.id}"...`);
      });
    }

    if (jobOptions.length > 0) {
      return {
        id: jobOptions[0].id,
        start: async () => {
          for (const start of startSequence) await start();
        },
        stop: async () => {
          for (const stop of stopSequence) await stop();
        },
      };
    }

    return {
      id: "non-typed-job",
      start: async () => {
        return Promise.resolve();
      },
      stop: async () => {
        return Promise.resolve();
      },
    };
  }
}

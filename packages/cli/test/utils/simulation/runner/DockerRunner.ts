/* eslint-disable no-console */
import EventEmitter from "node:events";
import {sleep} from "@lodestar/utils";
import {
  ChildProcessWithJobOptions,
  Job,
  JobOptions,
  Runner,
  RunnerEvent,
  RunnerOptions,
  RunnerType,
} from "../interfaces.js";
import {startChildProcess, startJobs, stopChildProcess} from "../utils/child_process.js";

const dockerNetworkIpRange = "192.168.0";
const dockerNetworkName = "sim-env-net";

const convertJobOptionsToDocker = (
  jobOptions: JobOptions[],
  name: string,
  {image, dataVolumePath, exposePorts, dockerNetworkIp}: RunnerOptions[RunnerType.Docker]
): JobOptions[] => {
  const dockerJobOptions: JobOptions[] = [];

  for (const jobOption of jobOptions) {
    const jobArgs = ["run", "--rm", "--name", name, "-v", `${dataVolumePath}:/data`];

    if (jobOption.cli.env && Object.keys(jobOption.cli.env).length > 0) {
      jobArgs.push("-e");
      jobArgs.push(Object.keys(jobOption.cli.env).filter(Boolean).join(" "));
    }

    for (const port of exposePorts) {
      jobArgs.push("-p");
      jobArgs.push(`${port}:${port}`);
    }

    jobArgs.push(image);
    if (jobOption.cli.command !== "") {
      jobArgs.push(jobOption.cli.command);
    }
    jobArgs.push(...jobOption.cli.args);

    dockerJobOptions.push({
      ...jobOption,
      cli: {
        ...jobOption.cli,
        command: "docker",
        args: jobArgs,
      },
      children: jobOption.children
        ? convertJobOptionsToDocker(jobOption.children, name, {image, dataVolumePath, exposePorts, dockerNetworkIp})
        : [],
    });
  }

  return dockerJobOptions;
};

const connectContainerToNetwork = async (container: string, ip: string, logFilePath: string): Promise<void> => {
  await startChildProcess({
    id: `connect ${container} to network ${dockerNetworkName}`,
    cli: {
      command: "docker",
      args: ["network", "connect", dockerNetworkName, container, "--ip", ip],
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
  });
};

export class DockerRunner implements Runner<RunnerType.Docker> {
  type = RunnerType.Docker as const;

  private emitter = new EventEmitter({captureRejections: true});
  private ipIndex = 2;
  private logFilePath: string;

  constructor(logFilePath: string) {
    this.logFilePath = logFilePath;
  }

  async start(): Promise<void> {
    try {
      await startChildProcess({
        id: `create docker network '${dockerNetworkName}'`,
        cli: {
          command: "docker",
          args: ["network", "create", "--subnet", `${dockerNetworkIpRange}.0/24`, dockerNetworkName],
        },
        logs: {
          stdoutFilePath: this.logFilePath,
        },
      });
    } catch (e) {
      // During multiple sim tests files the network might already exist
      console.error(e);
    }
  }

  async stop(): Promise<void> {
    // Wait for couple of seconds to allow docker to cleanup containers to network connections
    for (let i = 0; i < 5; i++) {
      try {
        await startChildProcess({
          id: `docker network rm '${dockerNetworkName}'`,
          cli: {
            command: "docker",
            args: ["network", "rm", dockerNetworkName],
          },
          logs: {
            stdoutFilePath: this.logFilePath,
          },
        });
        return;
      } catch {
        await sleep(5000);
      }
    }
  }

  getNextIp(): string {
    return `${dockerNetworkIpRange}.${this.ipIndex++}`;
  }

  on(event: RunnerEvent, cb: () => void | Promise<void>): void {
    this.emitter.on(event, cb);
  }

  create(
    id: string,
    jobs: JobOptions[],
    {image, dataVolumePath, exposePorts, dockerNetworkIp}: RunnerOptions[RunnerType.Docker]
  ): Job {
    const childProcesses: ChildProcessWithJobOptions[] = [];

    const dockerJobOptions = convertJobOptionsToDocker(jobs, id, {image, dataVolumePath, exposePorts, dockerNetworkIp});

    const stop = async (): Promise<void> => {
      console.log(`DockerRunner stopping '${id}'...`);
      this.emitter.emit("stopping");
      for (const {jobOptions, childProcess} of childProcesses) {
        if (jobOptions.teardown) {
          await jobOptions.teardown();
        }
        await stopChildProcess(childProcess);
      }

      console.log(`DockerRunner stopped '${id}'`);
      this.emitter.emit("stopped");
    };

    const start = (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        void (async () => {
          try {
            console.log(`Starting "${id}"...`);
            this.emitter.emit("starting");
            childProcesses.push(...(await startJobs(dockerJobOptions)));
            console.log(`Started "${id}"...`);
            this.emitter.emit("started");

            await connectContainerToNetwork(id, dockerNetworkIp, this.logFilePath);
            console.log(`DockerRunner connected container to network '${id}'`);
            resolve();
          } catch (err) {
            reject(err);
          }
        })();
      });

    return {id, start, stop, type: this.type};
  }
}

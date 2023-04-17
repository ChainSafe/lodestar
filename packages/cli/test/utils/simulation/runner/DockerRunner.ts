/* eslint-disable no-console */
import {ChildProcess} from "node:child_process";
import {sleep} from "@lodestar/utils";
import {Job, JobOptions, RunnerEnv, RunnerType} from "../interfaces.js";
import {startChildProcess, stopChildProcess} from "../utils/child_process.js";

const dockerNetworkIpRange = "192.168.0";
const dockerNetworkName = "sim-env-net";

export class DockerRunner implements RunnerEnv<RunnerType.Docker> {
  type = RunnerType.Docker as const;

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
    } catch {
      // During multiple sim tests files the network might already exist
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

  create(jobOption: Omit<JobOptions<RunnerType.Docker>, "children">): Job {
    const jobArgs = ["run", "--rm", "--name", jobOption.id];

    if (jobOption.options.dockerNetworkIp) {
      jobArgs.push("--network", dockerNetworkName);
      jobArgs.push("--ip", jobOption.options.dockerNetworkIp);
    }

    // Mount volumes
    if (jobOption.options.mounts) {
      for (const [hostPath, containerPath] of jobOption.options.mounts) {
        jobArgs.push("-v", `${hostPath}:${containerPath}`);
      }
    }

    // Pass ENV variables
    if (jobOption.cli.env && Object.keys(jobOption.cli.env).length > 0) {
      jobArgs.push("-e");
      jobArgs.push(Object.keys(jobOption.cli.env).filter(Boolean).join(" "));
    }

    // Expose ports
    for (const port of jobOption.options.exposePorts ?? []) {
      jobArgs.push("-p");
      jobArgs.push(`${port}:${port}`);
    }

    jobArgs.push(jobOption.options.image);
    if (jobOption.cli.command !== "") {
      jobArgs.push(jobOption.cli.command);
    }
    jobArgs.push(...jobOption.cli.args);

    let childProcess: ChildProcess;

    return {
      id: jobOption.id,
      start: async () => {
        childProcess = await startChildProcess({
          id: jobOption.id,
          logs: jobOption.logs,
          cli: {...jobOption.cli, command: "docker", args: jobArgs},
          health: jobOption.health,
        });
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

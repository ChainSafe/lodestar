/* eslint-disable no-console */
import {ChildProcess} from "node:child_process";
import {sleep} from "@lodestar/utils";
import {
  ChildProcessHealthStatus,
  SpawnChildProcessOptions,
  execChildProcess,
  spawnChildProcess,
  stopChildProcess,
  ChildProcessResolve,
} from "@lodestar/test-utils";
import {Job, JobOptions, RunnerEnv, RunnerType} from "../interfaces.js";

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
      await execChildProcess(`docker network create --subnet ${dockerNetworkIpRange}.0/24 ${dockerNetworkName}`, {
        logPrefix: "docker-runner",
        pipeStdioToFile: this.logFilePath,
      });
    } catch {
      // During multiple sim tests files the network might already exist
    }
  }

  async stop(): Promise<void> {
    // Wait for couple of seconds to allow docker to cleanup containers to network connections
    for (let i = 0; i < 5; i++) {
      try {
        await execChildProcess(`docker network rm ${dockerNetworkName}`, {
          logPrefix: "docker-runner",
          pipeStdioToFile: this.logFilePath,
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
    const jobArgs = ["run", "--rm", "--name", jobOption.id, "--add-host", "host.docker.internal:host-gateway"];

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

    const spawnOpts: SpawnChildProcessOptions = {
      env: jobOption.cli.env,
      pipeStdioToFile: jobOption.logs.stdoutFilePath,
      logPrefix: jobOption.id,
    };

    const health = jobOption.health;

    if (health) {
      spawnOpts.healthTimeoutMs = 30000;
      spawnOpts.health = async (): Promise<ChildProcessHealthStatus> =>
        health()
          .then((status) => {
            return status.ok ? {healthy: true} : {healthy: false};
          })
          .catch((error) => {
            return {healthy: false, message: (error as Error).message};
          });
    } else {
      spawnOpts.resolveOn = ChildProcessResolve.Completion;
    }

    return {
      id: jobOption.id,
      start: async () => {
        childProcess = await spawnChildProcess("docker", jobArgs, spawnOpts);
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

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable no-console */
import stream from "node:stream";
import fs from "node:fs";
import path from "node:path";
import {
  GenericContainer,
  StartedNetwork,
  StartedTestContainer,
  StartupStatus,
  StartupCheckStrategy,
  getContainerRuntimeClient,
  ContainerRuntimeClient,
} from "testcontainers";
import {retry} from "@lodestar/utils";
import {Job, JobOptions, RunnerEnv, RunnerType} from "../interfaces.js";
import {DOCKER_NETWORK_NAME, DOCKET_NETWORK_RANGE, DOCKET_NETWORK_SUBNET} from "../constants.js";

class SimContainer extends GenericContainer {
  withAutoRemove(autoRemove: boolean): this {
    this.hostConfig.AutoRemove = autoRemove;
    return this;
  }
  withNetworkAndIp(network: StartedNetwork, ip: string): this {
    super.withNetwork(network);

    this.createOpts.NetworkingConfig = {
      ...this.createOpts.NetworkingConfig,
      EndpointsConfig: {
        ...this.createOpts.NetworkingConfig?.EndpointsConfig,
        [network.getName()]: {IPAMConfig: {IPv4Address: ip}},
      },
    };
    return this;
  }
}

class HealthWaitStrategy extends StartupCheckStrategy {
  constructor(
    private health: () => Promise<{ok: boolean}>,
    client: ContainerRuntimeClient
  ) {
    super(client);
  }

  checkStartupState(_dockerClient: any, _containerId: string): Promise<StartupStatus> {
    return new Promise((resolve) => {
      const intervalId = setInterval(() => {
        this.health()
          .then((status) => {
            if (status.ok) {
              clearInterval(intervalId);
              resolve("SUCCESS");
            } else {
              resolve("PENDING");
            }
          })
          .catch(() => {
            resolve("PENDING");
          });
      }, 1000);
    });
  }
}

class DelayStrategy extends StartupCheckStrategy {
  constructor(
    private delayMs: number,
    client: ContainerRuntimeClient
  ) {
    super(client);
  }

  checkStartupState(_dockerClient: any, _containerId: string): Promise<StartupStatus> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve("SUCCESS");
      }, this.delayMs);
    });
  }
}

type DockerApiError = {
  statusCode: number;
};
function isDockerApiError(err: any): err is DockerApiError {
  return "statusCode" in err;
}

async function stopContainerWithRetries(container: StartedTestContainer): Promise<void> {
  return retry(
    async () => {
      try {
        await container.stop({remove: true});
      } catch (err) {
        if (isDockerApiError(err) && err.statusCode === 404) {
          // Container already stopped
          return;
        } else {
          throw err;
        }
      }
    },
    {
      retries: 5,
      retryDelay: 500,
    }
  );
}

export class DockerRunner implements RunnerEnv<RunnerType.Docker> {
  type = RunnerType.Docker as const;

  private ipIndex = 2;
  private logFilePath: string;
  private dockerNetwork!: StartedNetwork;

  constructor(logFilePath: string) {
    this.logFilePath = logFilePath;
  }

  async start(): Promise<void> {
    const docker = await getContainerRuntimeClient();
    let network = docker.network.getById(DOCKER_NETWORK_NAME);
    try {
      await network.inspect();
      await retry(
        async () => {
          try {
            await network.remove();
          } catch (err) {
            if (isDockerApiError(err) && err.statusCode === 404) {
              // Network already removed
              return;
            }
            throw err;
          }
        },
        {retries: 5, retryDelay: 500}
      );
    } catch {
      // Network does not exist
    }

    network = await docker.network.create({
      Name: DOCKER_NETWORK_NAME,
      Driver: "bridge",
      CheckDuplicate: false,
      IPAM: {
        Driver: "default",
        Options: {},
        Config: [
          {
            Subnet: DOCKET_NETWORK_SUBNET,
          },
        ],
      },
    });
    this.dockerNetwork = new StartedNetwork(docker, DOCKER_NETWORK_NAME, network);
  }

  async stop(): Promise<void> {
    try {
      await this.dockerNetwork.stop();
    } catch (e) {
      // Network does not exist or containers are stopping
    }
  }

  getNextIp(): string {
    return `${DOCKET_NETWORK_RANGE}.${this.ipIndex++}`;
  }

  create(jobOption: Omit<JobOptions<RunnerType.Docker>, "children">): Job {
    let startedContainer: StartedTestContainer | undefined;
    const container = new SimContainer(jobOption.options.image)
      .withAutoRemove(true)
      // .withName(jobOption.id)
      .withLabels({jobId: jobOption.id})
      .withExtraHosts([{host: "host.docker.internal", ipAddress: "host-gateway"}]);

    // Mount volumes
    if (jobOption.options.mounts) {
      for (const [hostPath, containerPath] of jobOption.options.mounts) {
        container.withBindMounts([{source: hostPath, target: containerPath}]);
      }
    }

    // Pass ENV variables
    if (jobOption.cli.env) {
      container.withEnvironment(jobOption.cli.env);
    }

    // Expose ports
    if (jobOption.options.exposePorts) {
      container.withExposedPorts(...jobOption.options.exposePorts.map((p) => ({container: p, host: p})));
    }

    if (jobOption.cli.command !== "") {
      container.withCommand([jobOption.cli.command, ...jobOption.cli.args]);
    } else {
      container.withCommand([...jobOption.cli.args]);
    }

    if (jobOption.logs.stdoutFilePath) {
      fs.mkdirSync(path.dirname(jobOption.logs.stdoutFilePath), {recursive: true});
      const logPrefixStream = new stream.Transform({
        transform(chunk, _encoding, callback) {
          callback(null, `[${jobOption.id}]: ${Buffer.from(chunk).toString("utf8")}`);
        },
      });
      const stdoutFileStream = fs.createWriteStream(jobOption.logs.stdoutFilePath);
      container.withLogConsumer((stream) => stream.pipe(logPrefixStream).pipe(stdoutFileStream));
    }

    return {
      id: jobOption.id,
      start: async () => {
        if (jobOption.options.dockerNetworkIp) {
          container.withNetworkAndIp(this.dockerNetwork, jobOption.options.dockerNetworkIp);
          // jobArgs.push("--ip", jobOption.options.dockerNetworkIp);
        }

        const docker = await getContainerRuntimeClient();

        container.withWaitStrategy(
          jobOption.health ? new HealthWaitStrategy(jobOption.health, docker) : new DelayStrategy(5000, docker)
        );
        startedContainer = await container.start();
      },
      stop: async () => {
        if (startedContainer) await stopContainerWithRetries(startedContainer);
      },
    };
  }
}

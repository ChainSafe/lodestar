import {writeFile} from "node:fs/promises";
import path from "node:path";
import got, {RequestError} from "got";
import yaml from "js-yaml";
import {getClient} from "@lodestar/api/beacon";
import {chainConfigToJson} from "@lodestar/config";
import {BeaconClient, BeaconNodeGenerator, LighthouseAPI, RunnerType} from "../../interfaces.js";
import {getNodeMountedPaths} from "../../utils/paths.js";
import {getNodePorts} from "../../utils/ports.js";

export const generateLighthouseBeaconNode: BeaconNodeGenerator<BeaconClient.Lighthouse> = (opts, runner) => {
  if (!process.env.LIGHTHOUSE_BINARY_PATH && !process.env.LIGHTHOUSE_DOCKER_IMAGE) {
    throw new Error("LIGHTHOUSE_BINARY_PATH or LIGHTHOUSE_DOCKER_IMAGE must be provided");
  }

  const isDocker = process.env.LIGHTHOUSE_DOCKER_IMAGE !== undefined;

  const {address, id, forkConfig, nodeIndex, metrics} = opts;
  const {engineUrls, engineMock, clientOptions} = opts;
  const ports = getNodePorts(nodeIndex);

  const {rootDir, rootDirMounted, jwtsecretFilePathMounted, logFilePath} = getNodeMountedPaths(
    opts.paths,
    "/data",
    isDocker
  );

  const cliParams: Record<string, unknown> = {
    "testnet-dir": rootDirMounted,
    datadir: rootDirMounted,
    http: null,
    //  Enable the RESTful HTTP API server. Disabled by default.
    // Forces the HTTP to indicate that the node is synced when sync is actually
    // stalled. This is useful for very small testnets. TESTING ONLY. DO NOT USE ON MAINNET.
    "http-allow-sync-stalled": null,
    "http-address": "0.0.0.0",
    "http-port": ports.beacon.httpPort,
    "http-allow-origin": "*",
    "listen-address": "0.0.0.0",
    port: ports.beacon.p2pPort,
    "enr-address": address,
    "enr-udp-port": ports.beacon.p2pPort,
    "enr-tcp-port": ports.beacon.p2pPort,
    "disable-discovery": null,
    "enable-private-discovery": null,
    "debug-level": "debug",
    ...clientOptions,
  };

  if (engineMock) {
    cliParams["dummy-eth1"] = null;
  } else {
    cliParams["execution-jwt"] = jwtsecretFilePathMounted;
    cliParams["execution-endpoint"] = [...engineUrls].join(",");
  }

  if (metrics) {
    cliParams["metrics-allow-origin"] = "*";
    cliParams["metrics-port"] = metrics.port;
    cliParams["metrics-address"] = metrics.host;
  }

  const job = runner.create([
    {
      id,
      type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
      options: isDocker
        ? {
            image: process.env.LIGHTHOUSE_DOCKER_IMAGE as string,
            mounts: [[rootDir, rootDirMounted]],
            exposePorts: [ports.beacon.httpPort, ports.beacon.p2pPort],
            dockerNetworkIp: address,
          }
        : undefined,
      bootstrap: async () => {
        await writeFile(path.join(rootDir, "config.yaml"), yaml.dump(chainConfigToJson(forkConfig)));
        await writeFile(path.join(rootDir, "deploy_block.txt"), "0");
      },
      cli: {
        command: isDocker ? "lighthouse" : (process.env.LIGHTHOUSE_BINARY_PATH as string),
        args: [
          "beacon_node",
          ...Object.entries(cliParams).flatMap(([key, value]) =>
            value === null ? [`--${key}`] : [`--${key}`, String(value)]
          ),
        ],
        env: {},
      },
      logs: {
        stdoutFilePath: logFilePath,
      },
      health: async () => {
        try {
          await got.get(`http://127.0.0.1:${ports.beacon.httpPort}/eth/v1/node/health`);
        } catch (err) {
          if (err instanceof RequestError && err.code !== "ECONNREFUSED") {
            return;
          }
          throw err;
        }
      },
    },
  ]);

  const api = getClient(
    {baseUrl: `http://127.0.0.1:${ports.beacon.httpPort}`},
    {config: forkConfig}
  ) as unknown as LighthouseAPI;
  api.lighthouse = {
    async getPeers() {
      const res = await got(`http://127.0.0.1:${ports.beacon.httpPort}/lighthouse/peers`);
      return {body: JSON.parse(res.body), status: res.statusCode};
    },
  };

  return {
    id,
    client: BeaconClient.Lighthouse,
    restPublicUrl: `http://127.0.0.1:${ports.beacon.httpPort}`,
    restPrivateUrl: `http://${address}:${ports.beacon.httpPort}`,
    api,
    job,
  };
};

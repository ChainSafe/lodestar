/* eslint-disable @typescript-eslint/naming-convention */
import {writeFile} from "node:fs/promises";
import path from "node:path";
import got, {RequestError} from "got";
import yaml from "js-yaml";
import {HttpClient} from "@lodestar/api";
import {getClient} from "@lodestar/api/beacon";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {chainConfigToJson} from "@lodestar/config";
import {
  CLClient,
  CLClientGenerator,
  CLClientGeneratorOptions,
  IRunner,
  JobOptions,
  LighthouseAPI,
  RunnerType,
} from "../interfaces.js";
import {getNodePorts} from "../utils/ports.js";
import {getNodeMountedPaths} from "../utils/paths.js";
import {updateKeystoresPath} from "../utils/keys.js";

export const generateLighthouseBeaconNode: CLClientGenerator<CLClient.Lighthouse> = (opts, runner) => {
  if (!process.env.LIGHTHOUSE_BINARY_PATH && !process.env.LIGHTHOUSE_DOCKER_IMAGE) {
    throw new Error("LIGHTHOUSE_BINARY_PATH or LIGHTHOUSE_DOCKER_IMAGE must be provided");
  }

  const isDocker = process.env.LIGHTHOUSE_DOCKER_IMAGE !== undefined;

  const {address, id, config, keys, nodeIndex} = opts;
  const {engineUrls, engineMock, clientOptions} = opts;
  const {
    cl: {httpPort, port, keymanagerPort},
  } = getNodePorts(nodeIndex);

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
    "http-port": httpPort,
    "http-allow-origin": "*",
    "listen-address": "0.0.0.0",
    port: port,
    "enr-address": address,
    "enr-udp-port": port,
    "enr-tcp-port": port,
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

  const beaconNodeJob: JobOptions = {
    id,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.LIGHTHOUSE_DOCKER_IMAGE as string,
          mounts: [[rootDir, rootDirMounted]],
          exposePorts: [httpPort, port],
          dockerNetworkIp: address,
        }
      : undefined,
    bootstrap: async () => {
      await writeFile(path.join(rootDir, "config.yaml"), yaml.dump(chainConfigToJson(config)));
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
        await got.get(`http://127.0.0.1:${httpPort}/eth/v1/node/health`);
        return {ok: true};
      } catch (err) {
        if (err instanceof RequestError && err.code !== "ECONNREFUSED") {
          return {ok: true};
        }
        return {ok: false, reason: (err as Error).message, checkId: "/eth/v1/node/health query"};
      }
    },
  };

  const validatorClientsJobs: JobOptions[] = [];
  if (keys.type !== "no-keys") {
    validatorClientsJobs.push(
      generateLighthouseValidatorJobs(
        {
          ...opts,
          id: `${id}-validator`,
          paths: {
            ...opts.paths,
            logFilePath: path.join(path.dirname(logFilePath), `${id}-validator.log`),
          },
        },
        runner
      )
    );
  }

  const httpClient = new HttpClient({baseUrl: `http://127.0.0.1:${httpPort}`});
  const api = (getClient({baseUrl: `http://127.0.0.1:${httpPort}`}, {config}) as unknown) as LighthouseAPI;
  api.lighthouse = {
    async getPeers() {
      return httpClient.json({url: "/lighthouse/peers", method: "GET"});
    },
  };

  return {
    id,
    client: CLClient.Lighthouse,
    url: `http://127.0.0.1:${httpPort}`,
    keys,
    api,
    keyManager: keyManagerGetClient({baseUrl: `http://127.0.0.1:${keymanagerPort}`}, {config}),
    job: runner.create([{...beaconNodeJob, children: [...validatorClientsJobs]}]),
  };
};

export const generateLighthouseValidatorJobs = (opts: CLClientGeneratorOptions, runner: IRunner): JobOptions => {
  const isDocker = process.env.LIGHTHOUSE_DOCKER_IMAGE !== undefined;

  const binaryPath = isDocker ? "lighthouse" : `${process.env.LIGHTHOUSE_BINARY_PATH}`;
  const {id, keys, address} = opts;
  const {
    rootDir,
    rootDirMounted,
    logFilePath,
    validatorsDirMounted,
    validatorsDefinitionFilePath,
    validatorsDefinitionFilePathMounted,
  } = getNodeMountedPaths(opts.paths, "/data", isDocker);
  const {
    cl: {httpPort, keymanagerPort},
  } = getNodePorts(opts.nodeIndex);

  if (keys.type === "no-keys") {
    throw Error("Attempting to run a vc with keys.type == 'no-keys'");
  }

  const params = {
    "testnet-dir": rootDirMounted,
    "beacon-nodes": `http://${address}:${httpPort}/`,
    "debug-level": "debug",
    "init-slashing-protection": null,
    "allow-unsynced": null,
    http: null,
    "unencrypted-http-transport": null,
    "http-address": "0.0.0.0",
    "http-port": keymanagerPort,
    "validators-dir": validatorsDirMounted,
  };

  return {
    id,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.LIGHTHOUSE_DOCKER_IMAGE as string,
          mounts: [[rootDir, rootDirMounted]],
          dockerNetworkIp: runner.getNextIp(),
        }
      : undefined,
    bootstrap: async () => {
      if (isDocker) {
        await updateKeystoresPath(
          validatorsDefinitionFilePath,
          path.dirname(validatorsDefinitionFilePathMounted),
          validatorsDefinitionFilePath
        );
      }
    },
    cli: {
      command: binaryPath,
      args: [
        "validator_client",
        ...Object.entries(params).flatMap(([key, value]) =>
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
        await got.get(`http://127.0.0.1:${keymanagerPort}/lighthouse/health`);
        return {ok: true};
      } catch (err) {
        if (err instanceof RequestError) {
          return {ok: true};
        }
        return {ok: false, reason: (err as Error).message, checkId: "/lighthouse/health query"};
      }
    },
  };
};

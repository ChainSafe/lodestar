/* eslint-disable @typescript-eslint/naming-convention */
import {writeFile} from "node:fs/promises";
import path from "node:path";
import got from "got";
import {getClient} from "@lodestar/api/beacon";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {chainConfigToJson} from "@lodestar/config";
import {LogLevel} from "@lodestar/utils";
import {BeaconArgs} from "../../../../src/cmds/beacon/options.js";
import {IValidatorCliArgs} from "../../../../src/cmds/validator/options.js";
import {GlobalArgs} from "../../../../src/options/globalOptions.js";
import {LODESTAR_BINARY_PATH} from "../constants.js";
import {CLClient, CLClientGenerator, CLClientGeneratorOptions, JobOptions, RunnerType} from "../interfaces.js";
import {getNodePorts} from "../utils/ports.js";

export const generateLodestarBeaconNode: CLClientGenerator<CLClient.Lodestar> = (opts, runner) => {
  const {address, id, config, keys, genesisTime, engineUrls, engineMock, clientOptions, nodeIndex} = opts;
  const {
    paths: {jwtsecretFilePath, rootDir, genesisFilePath, logFilePath},
  } = opts;
  const ports = getNodePorts(nodeIndex);

  const rcConfigPath = path.join(rootDir, "rc_config.json");
  const paramsPath = path.join(rootDir, "params.json");

  const rcConfig = ({
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    genesisStateFile: genesisFilePath,
    rest: true,
    "rest.address": "0.0.0.0",
    "rest.port": ports.cl.httpPort,
    "rest.namespace": "*",
    "sync.isSingleNode": false,
    "network.allowPublishToZeroPeers": false,
    discv5: true,
    "network.connectToDiscv5Bootnodes": true,
    "network.rateLimitMultiplier": 0,
    listenAddress: "0.0.0.0",
    port: ports.cl.port,
    metrics: false,
    bootnodes: [],
    logPrefix: id,
    logFormatGenesisTime: `${genesisTime}`,
    logLevel: LogLevel.debug,
    logFileDailyRotate: 0,
    logFile: "none",
    "jwt-secret": jwtsecretFilePath,
    paramsFile: paramsPath,
    ...clientOptions,
  } as unknown) as BeaconArgs & GlobalArgs;

  if (engineMock) {
    rcConfig["eth1"] = false;
    rcConfig["execution.engineMock"] = true;
    rcConfig["execution.urls"] = [];
  } else {
    rcConfig["eth1"] = true;
    rcConfig["execution.engineMock"] = false;
    rcConfig["execution.urls"] = [...engineUrls];
  }

  const validatorClientsJobs: JobOptions[] = [];
  if (keys.type !== "no-keys") {
    validatorClientsJobs.push(
      generateLodestarValidatorJobs({
        ...opts,
        id: `${id}-validator`,
        paths: {
          ...opts.paths,
          logFilePath: path.join(path.dirname(logFilePath), `${id}-validator.log`),
        },
      })
    );
  }

  const job = runner.create([
    {
      id,
      bootstrap: async () => {
        await writeFile(rcConfigPath, JSON.stringify(rcConfig, null, 2));
        await writeFile(paramsPath, JSON.stringify(chainConfigToJson(config), null, 2));
      },
      type: RunnerType.ChildProcess,
      cli: {
        command: LODESTAR_BINARY_PATH,
        args: ["beacon", "--rcConfig", rcConfigPath, "--paramsFile", paramsPath],
        env: {
          DEBUG: process.env.DISABLE_DEBUG_LOGS ? "" : "*,-winston:*",
        },
      },
      logs: {
        stdoutFilePath: logFilePath,
      },
      health: async () => {
        try {
          await got.get(`http://${address}:${ports.cl.httpPort}/eth/v1/node/health`);
          return {ok: true};
        } catch (err) {
          return {ok: false, reason: (err as Error).message, checkId: "eth/v1/node/health query"};
        }
      },
      children: validatorClientsJobs,
    },
  ]);

  return {
    id,
    client: CLClient.Lodestar,
    url: `http://127.0.0.1:${ports.cl.httpPort}`,
    keys,
    api: getClient({baseUrl: `http://127.0.0.1:${ports.cl.httpPort}`}, {config}),
    keyManager: keyManagerGetClient({baseUrl: `http://127.0.0.1:${ports.cl.keymanagerPort}`}, {config}),
    job,
  };
};

export const generateLodestarValidatorJobs = (opts: CLClientGeneratorOptions): JobOptions => {
  const {paths, id, keys, config, genesisTime, nodeIndex} = opts;
  const {rootDir, keystoresDir, keystoresSecretFilePath, logFilePath} = paths;
  const ports = getNodePorts(nodeIndex);

  if (keys.type === "no-keys") {
    throw Error("Attempting to run a vc with keys.type == 'no-keys'");
  }

  const rcConfig = ({
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    server: `http://0.0.0.0:${ports.cl.httpPort}/`,
    keymanager: true,
    "keymanager.authEnabled": false,
    "keymanager.address": "127.0.0.1",
    "keymanager.port": ports.cl.keymanagerPort,
    logPrefix: id,
    logFormatGenesisTime: genesisTime,
    logLevel: LogLevel.debug,
    logFile: "none",
    importKeystores: keystoresDir,
    importKeystoresPassword: keystoresSecretFilePath,
  } as unknown) as IValidatorCliArgs & GlobalArgs;

  return {
    id,
    type: RunnerType.ChildProcess,
    bootstrap: async () => {
      await writeFile(path.join(rootDir, "rc_config.json"), JSON.stringify(rcConfig, null, 2));
      await writeFile(path.join(rootDir, "params.json"), JSON.stringify(chainConfigToJson(config), null, 2));
    },
    cli: {
      command: LODESTAR_BINARY_PATH,
      args: [
        "validator",
        "--rcConfig",
        path.join(rootDir, "rc_config.json"),
        "--paramsFile",
        path.join(rootDir, "params.json"),
      ],
      env: {
        DEBUG: process.env.DISABLE_DEBUG_LOGS ? "" : "*,-winston:*",
      },
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
    health: async () => {
      try {
        await got.get(`http://127.0.0.1:${ports.cl.keymanagerPort}/eth/v1/keystores`);
        return {ok: true};
      } catch (err) {
        return {ok: false, reason: (err as Error).message, checkId: "eth/v1/keystores query"};
      }
    },
  };
};

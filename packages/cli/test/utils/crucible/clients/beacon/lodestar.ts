import {writeFile} from "node:fs/promises";
import path from "node:path";
import got from "got";
import {getClient} from "@lodestar/api/beacon";
import {chainConfigToJson} from "@lodestar/config";
import {LogLevel} from "@lodestar/utils";
import {BeaconArgs} from "../../../../../src/cmds/beacon/options.js";
import {GlobalArgs} from "../../../../../src/options/globalOptions.js";
import {LODESTAR_BINARY_PATH} from "../../constants.js";
import {BeaconClient, BeaconNodeGenerator, RunnerType} from "../../interfaces.js";
import {getNodePorts} from "../../utils/ports.js";

export const generateLodestarBeaconNode: BeaconNodeGenerator<BeaconClient.Lodestar> = (opts, runner) => {
  const {
    address,
    id,
    forkConfig: config,
    genesisTime,
    engineUrls,
    engineMock,
    clientOptions,
    nodeIndex,
    metrics,
  } = opts;
  const {
    paths: {jwtsecretFilePath, rootDir, genesisFilePath, logFilePath},
  } = opts;
  const ports = getNodePorts(nodeIndex);

  const rcConfigPath = path.join(rootDir, "rc_config.json");
  const paramsPath = path.join(rootDir, "params.json");

  const rcConfig = {
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    genesisStateFile: genesisFilePath,
    rest: true,
    "rest.address": "0.0.0.0",
    "rest.port": ports.beacon.httpPort,
    "rest.namespace": "*",
    "sync.isSingleNode": false,
    "network.allowPublishToZeroPeers": false,
    discv5: true,
    "network.connectToDiscv5Bootnodes": true,
    "network.rateLimitMultiplier": 0,
    listenAddress: "0.0.0.0",
    port: ports.beacon.p2pPort,
    bootnodes: [],
    logPrefix: id,
    logFormatGenesisTime: `${genesisTime}`,
    logLevel: LogLevel.debug,
    logFileDailyRotate: 0,
    logFile: "none",
    jwtSecret: jwtsecretFilePath,
    paramsFile: paramsPath,
    ...clientOptions,
  } as unknown as BeaconArgs & GlobalArgs;

  if (engineMock) {
    rcConfig["eth1"] = false;
    rcConfig["execution.engineMock"] = true;
    rcConfig["execution.urls"] = [];
  } else {
    rcConfig["eth1"] = true;
    rcConfig["execution.engineMock"] = false;
    rcConfig["execution.urls"] = [...engineUrls];
  }

  if (metrics) {
    rcConfig.metrics = true;
    rcConfig["metrics.port"] = metrics.port;
    rcConfig["metrics.address"] = metrics.host;
  } else {
    rcConfig.metrics = false;
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
        await got.get(`http://${address}:${ports.beacon.httpPort}/eth/v1/node/health`);
      },
    },
  ]);

  return {
    id,
    client: BeaconClient.Lodestar,
    restPublicUrl: `http://127.0.0.1:${ports.beacon.httpPort}`,
    // Lodestar runs on the host machine, so it don't have a private url
    restPrivateUrl: `http://127.0.0.1:${ports.beacon.httpPort}`,
    api: getClient({baseUrl: `http://127.0.0.1:${ports.beacon.httpPort}`}, {config}),
    job,
  };
};

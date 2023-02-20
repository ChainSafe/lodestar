/* eslint-disable @typescript-eslint/naming-convention */
import {mkdir, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import got from "got";
import {Keystore} from "@chainsafe/bls-keystore";
import {getClient} from "@lodestar/api/beacon";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {chainConfigToJson} from "@lodestar/config";
import {LogLevel} from "@lodestar/utils";
import {BeaconArgs} from "../../../../src/cmds/beacon/options.js";
import {IValidatorCliArgs} from "../../../../src/cmds/validator/options.js";
import {GlobalArgs} from "../../../../src/options/globalOptions.js";
import {LODESTAR_BINARY_PATH} from "../constants.js";
import {CLClient, CLClientGenerator, CLClientGeneratorOptions, JobOptions, RunnerType} from "../interfaces.js";

export const generateLodestarBeaconNode: CLClientGenerator<CLClient.Lodestar> = (opts, runner) => {
  const {
    dataDir,
    address,
    restPort,
    port,
    id,
    config,
    genesisStateFilePath,
    keys,
    keyManagerPort,
    genesisTime,
    engineUrls,
    engineMock,
    jwtSecretHex,
    clientOptions,
  } = opts;

  const jwtSecretPath = join(dataDir, "jwtsecret");
  const rcConfigPath = join(dataDir, "rc_config.json");
  const paramsPath = join(dataDir, "params.json");

  const rcConfig = ({
    network: "dev",
    preset: "minimal",
    dataDir,
    genesisStateFile: genesisStateFilePath,
    rest: true,
    "rest.address": "0.0.0.0",
    "rest.port": restPort,
    "rest.namespace": "*",
    "sync.isSingleNode": false,
    "network.allowPublishToZeroPeers": false,
    discv5: true,
    "network.connectToDiscv5Bootnodes": true,
    "network.rateLimitMultiplier": 0,
    listenAddress: "0.0.0.0",
    port: port,
    metrics: false,
    bootnodes: [],
    logPrefix: id,
    logFormatGenesisTime: `${genesisTime}`,
    logLevel: LogLevel.debug,
    logFileDailyRotate: 0,
    logFile: "none",
    "jwt-secret": jwtSecretPath,
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
        dataDir: join(dataDir, "validator"),
        id: `${id}-validator`,
        logFilePath: join(dirname(opts.logFilePath), `${id}-validator.log`),
      })
    );
  }

  const job = runner.create([
    {
      id,
      bootstrap: async () => {
        await mkdir(dataDir, {recursive: true});
        await writeFile(rcConfigPath, JSON.stringify(rcConfig, null, 2));
        await writeFile(jwtSecretPath, jwtSecretHex);
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
        stdoutFilePath: opts.logFilePath,
      },
      health: async () => {
        try {
          await got.get(`http://${address}:${restPort}/eth/v1/node/health`);
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
    url: `http://127.0.0.1:${restPort}`,
    keys,
    api: getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}),
    keyManager: keyManagerGetClient({baseUrl: `http://127.0.0.1:${keyManagerPort}`}, {config}),
    job,
  };
};

export const generateLodestarValidatorJobs = (opts: CLClientGeneratorOptions): JobOptions => {
  const {dataDir: rootDir, id, address, keyManagerPort, restPort, keys, config, genesisTime} = opts;

  if (keys.type === "no-keys") {
    throw Error("Attempting to run a vc with keys.type == 'no-keys'");
  }

  const rcConfig = ({
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    server: `http://0.0.0.0:${restPort}/`,
    keymanager: true,
    "keymanager.authEnabled": false,
    "keymanager.address": "127.0.0.1",
    "keymanager.port": keyManagerPort,
    logPrefix: id,
    logFormatGenesisTime: genesisTime,
    logLevel: LogLevel.debug,
    logFile: "none",
    importKeystores: `${rootDir}/keystores`,
    importKeystoresPassword: `${rootDir}/password.txt`,
  } as unknown) as IValidatorCliArgs & GlobalArgs;

  return {
    id,
    type: RunnerType.ChildProcess,
    bootstrap: async () => {
      await mkdir(rootDir);
      await mkdir(`${rootDir}/keystores`);
      await writeFile(join(rootDir, "password.txt"), "password");
      await writeFile(join(rootDir, "rc_config.json"), JSON.stringify(rcConfig, null, 2));
      await writeFile(join(rootDir, "params.json"), JSON.stringify(chainConfigToJson(config), null, 2));

      if (keys.type === "local") {
        for (const key of keys.secretKeys) {
          const keystore = await Keystore.create("password", key.toBytes(), key.toPublicKey().toBytes(), "");
          await writeFile(
            join(rootDir, "keystores", `${key.toPublicKey().toHex()}.json`),
            JSON.stringify(keystore.toObject(), null, 2)
          );
        }
      }
    },
    cli: {
      command: LODESTAR_BINARY_PATH,
      args: ["validator", "--rcConfig", join(rootDir, "rc_config.json"), "--paramsFile", join(rootDir, "params.json")],
      env: {
        DEBUG: process.env.DISABLE_DEBUG_LOGS ? "" : "*,-winston:*",
      },
    },
    logs: {
      stdoutFilePath: opts.logFilePath,
    },
    health: async () => {
      try {
        await got.get(`http://127.0.0.1:${keyManagerPort}/eth/v1/keystores`);
        return {ok: true};
      } catch (err) {
        return {ok: false, reason: (err as Error).message, checkId: "eth/v1/keystores query"};
      }
    },
  };
};

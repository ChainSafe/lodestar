/* eslint-disable @typescript-eslint/naming-convention */
import {mkdir, writeFile} from "node:fs/promises";
import fs from "node:fs";
import {dirname, join} from "node:path";
import got from "got";
import {Keystore} from "@chainsafe/bls-keystore";
import {getClient} from "@lodestar/api/beacon";
import {chainConfigToJson} from "@lodestar/config";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {dumpYaml, LogLevel} from "@lodestar/utils";
import {IBeaconArgs} from "../../../../src/cmds/beacon/options.js";
import {IValidatorCliArgs} from "../../../../src/cmds/validator/options.js";
import {IGlobalArgs} from "../../../../src/options/globalOptions.js";
import {CLClient, CLClientGenerator, CLClientGeneratorOptions, JobOptions, Runner, RunnerType} from "../interfaces.js";
import {LODESTAR_BINARY_PATH, MOCK_ETH1_GENESIS_HASH} from "../constants.js";
import {isChildProcessRunner} from "../runner/index.js";

export const generateLodestarBeaconNode: CLClientGenerator<CLClient.Lodestar> = (opts, runner) => {
  if (!isChildProcessRunner(runner)) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }
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
  const paramsPath = join(dataDir, "params.yaml");

  const rcConfig: Partial<IBeaconArgs & IGlobalArgs> = {
    network: "dev",
    preset: "minimal",
    dataDir,
    genesisStateFile: genesisStateFilePath,
    paramsFile: paramsPath,
    rest: true,
    "rest.address": address,
    "rest.port": restPort,
    "rest.namespace": ["*"],
    "sync.isSingleNode": false,
    "network.allowPublishToZeroPeers": false,
    discv5: true,
    "network.connectToDiscv5Bootnodes": true,
    listenAddress: address,
    port: port,
    metrics: false,
    bootnodes: [],
    logPrefix: id,
    logFormatGenesisTime: genesisTime,
    logLevel: LogLevel.debug,
    logFileDailyRotate: 0,
    logFile: "none",
    "jwt-secret": jwtSecretPath,
    ...clientOptions,
  };

  if (engineMock) {
    rcConfig["eth1"] = false;
    rcConfig["execution.engineMock"] = MOCK_ETH1_GENESIS_HASH;
    rcConfig["execution.urls"] = [];
  } else {
    rcConfig["eth1"] = true;
    rcConfig["execution.engineMock"] = false;
    rcConfig["execution.urls"] = [...engineUrls];
  }

  const validatorClientsJobs: JobOptions[] = [];
  if (keys.type !== "no-keys") {
    validatorClientsJobs.push(
      generateLodestarValidatorJobs(
        {
          ...opts,
          dataDir: join(dataDir, "validator"),
          id: `${id}-validator`,
          logFilePath: join(dirname(opts.logFilePath), `${id}-validator.log`),
        },
        runner
      )
    );
  }

  const job = runner.create(id, [
    {
      id,
      bootstrap: async () => {
        await mkdir(dataDir, {recursive: true});
        await writeFile(rcConfigPath, JSON.stringify(rcConfig, null, 2));
        await writeFile(jwtSecretPath, jwtSecretHex);
        fs.writeFileSync(paramsPath, dumpYaml(chainConfigToJson(config))); // There is no need to use async fs here =D
      },
      cli: {
        command: LODESTAR_BINARY_PATH,
        args: ["beacon", "--rcConfig", rcConfigPath, "--paramsFile", paramsPath] as string[],
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
    url: `http://${address}:${restPort}`,
    keys,
    api: getClient({baseUrl: `http://${address}:${restPort}`}, {config}),
    keyManager: keyManagerGetClient({baseUrl: `http://${address}:${keyManagerPort}`}, {config}),
    job,
  };
};

export const generateLodestarValidatorJobs = (
  opts: CLClientGeneratorOptions,
  runner: Runner<RunnerType.ChildProcess> | Runner<RunnerType.Docker>
): JobOptions => {
  if (runner.type !== RunnerType.ChildProcess) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }

  const {dataDir: rootDir, id, address, keyManagerPort, restPort, keys, config, genesisTime} = opts;

  if (keys.type === "no-keys") {
    throw Error("Attempting to run a vc with keys.type == 'no-keys'");
  }

  const configPath = join(rootDir, "config.yaml");

  const rcConfig = ({
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    paramsFile: configPath,
    server: `http://${address}:${restPort}/`,
    keymanager: true,
    "keymanager.authEnabled": false,
    "keymanager.address": address,
    "keymanager.port": keyManagerPort,
    logPrefix: id,
    logFormatGenesisTime: genesisTime,
    logLevel: LogLevel.debug,
    logFile: "none",
    importKeystores: `${rootDir}/keystores`,
    importKeystoresPassword: `${rootDir}/password.txt`,
  } as unknown) as IValidatorCliArgs & IGlobalArgs;

  return {
    id,
    bootstrap: async () => {
      await mkdir(rootDir);
      await mkdir(`${rootDir}/keystores`);
      await writeFile(join(rootDir, "password.txt"), "password");
      await writeFile(join(rootDir, "rc_config.json"), JSON.stringify(rcConfig, null, 2));
      fs.writeFileSync(configPath, dumpYaml(chainConfigToJson(config))); // There is no need to use async fs here =D

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
        await got.get(`http://${address}:${keyManagerPort}/eth/v1/keystores`);
        return {ok: true};
      } catch (err) {
        return {ok: false, reason: (err as Error).message, checkId: "eth/v1/keystores query"};
      }
    },
  };
};

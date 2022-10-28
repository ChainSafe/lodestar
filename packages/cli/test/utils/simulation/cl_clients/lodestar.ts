import {mkdir, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {Keystore} from "@chainsafe/bls-keystore";
import {getClient} from "@lodestar/api/beacon";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {LogLevel} from "@lodestar/utils";
import {IBeaconArgs} from "../../../../src/cmds/beacon/options.js";
import {IValidatorCliArgs} from "../../../../src/cmds/validator/options.js";
import {IGlobalArgs} from "../../../../src/options/globalOptions.js";
import {CLClient, CLClientGenerator, CLClientOptions, JobOptions, Runner, RunnerType} from "../interfaces.js";
import {callHttp, LODESTAR_BINARY_PATH} from "../utils.js";

export const generateLodeStarBeaconNode: CLClientGenerator = (opts: CLClientOptions, runner: Runner) => {
  if (runner.type !== RunnerType.ChildProcess) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }
  const {
    rootDir,
    address,
    restPort,
    port,
    id,
    config,
    genesisStateFilePath,
    checkpointSyncUrl,
    secretKeys,
    wssCheckpoint,
    keyManagerPort,
    genesisTime,
  } = opts;

  const rcConfig = ({
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    genesisStateFile: genesisStateFilePath,
    rest: true,
    "rest.address": address,
    "rest.port": restPort,
    "rest.namespace": "*",
    "sync.isSingleNode": false,
    "network.allowPublishToZeroPeers": false,
    eth1: false,
    discv5: true,
    "network.connectToDiscv5Bootnodes": true,
    "execution.engineMock": true,
    listenAddress: address,
    port: port,
    metrics: false,
    bootnodes: [],
    "params.SECONDS_PER_SLOT": String(config.SECONDS_PER_SLOT),
    "params.GENESIS_DELAY": String(config.GENESIS_DELAY),
    "params.ALTAIR_FORK_EPOCH": String(config.ALTAIR_FORK_EPOCH),
    "params.BELLATRIX_FORK_EPOCH": String(config.BELLATRIX_FORK_EPOCH),
    logPrefix: id,
    logFormatGenesisTime: `${genesisTime}`,
    logLevel: LogLevel.debug,
    logFileDailyRotate: 0,
  } as unknown) as IBeaconArgs & IGlobalArgs;

  if (checkpointSyncUrl) {
    rcConfig["checkpointSyncUrl"] = checkpointSyncUrl;
  }

  if (wssCheckpoint) {
    rcConfig["wssCheckpoint"] = wssCheckpoint;
  }

  const validatorClientsJobs: JobOptions[] = [];
  if (opts.secretKeys.length > 0) {
    validatorClientsJobs.push(
      generateLodeStarValidatorJobs(
        {
          ...opts,
          rootDir: join(rootDir, "validator"),
          id: `${id}-validator`,
          logFilePath: join(dirname(opts.logFilePath), `${id}-validator.log`),
        },
        runner
      )
    );
  }

  const job = runner.create(id, [
    {
      bootstrap: async () => {
        await mkdir(rootDir);
        await writeFile(join(rootDir, "rc_config.json"), JSON.stringify(rcConfig, null, 2));
      },
      cli: {
        command: LODESTAR_BINARY_PATH,
        args: ["beacon", "--rcConfig", join(rootDir, "rc_config.json")],
        env: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          DEBUG: "*,-winston:*",
        },
      },
      logs: {
        stdoutFilePath: opts.logFilePath,
      },
      health: async () => {
        try {
          await callHttp(`http://${address}:${restPort}/eth/v1/node/health`, "GET");
          return true;
        } catch {
          return false;
        }
      },
      children: validatorClientsJobs,
    },
  ]);

  const node = {
    id,
    client: CLClient.Lodestar,
    url: `http://${address}:${restPort}`,
    secretKeys,
    api: getClient({baseUrl: `http://${address}:${restPort}`}, {config}),
    keyManager: keyManagerGetClient({baseUrl: `http://${address}:${keyManagerPort}`}, {config}),
  };

  return {job, node};
};

export const generateLodeStarValidatorJobs = (opts: CLClientOptions, runner: Runner): JobOptions => {
  if (runner.type !== RunnerType.ChildProcess) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }

  const {
    rootDir,
    id,
    address,
    keyManagerPort,
    secretKeys,
    restPort,
    config,
    genesisTime,
    externalKeysPercentage,
  } = opts;

  const rcConfig = ({
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    server: `http://${address}:${restPort}/`,
    keymanager: true,
    "keymanager.authEnabled": false,
    "keymanager.address": address,
    "keymanager.port": keyManagerPort,
    "params.SECONDS_PER_SLOT": String(config.SECONDS_PER_SLOT),
    "params.GENESIS_DELAY": String(config.GENESIS_DELAY),
    "params.ALTAIR_FORK_EPOCH": String(config.ALTAIR_FORK_EPOCH),
    "params.BELLATRIX_FORK_EPOCH": String(config.BELLATRIX_FORK_EPOCH),
    logPrefix: id,
    logFormatGenesisTime: genesisTime,
    logLevel: LogLevel.debug,
    importKeystores: `${rootDir}/keystores`,
    importKeystoresPassword: `${rootDir}/password.txt`,
  } as unknown) as IValidatorCliArgs & IGlobalArgs;

  return {
    bootstrap: async () => {
      await mkdir(rootDir);
      await mkdir(`${rootDir}/keystores`);
      await writeFile(join(rootDir, "password.txt"), "password");
      await writeFile(join(rootDir, "rc_config.json"), JSON.stringify(rcConfig, null, 2));

      // Split half of the keys to the keymanager
      for (const key of secretKeys.slice(secretKeys.length * externalKeysPercentage)) {
        const keystore = await Keystore.create("password", key.toBytes(), key.toPublicKey().toBytes(), "");
        await writeFile(
          join(rootDir, "keystores", `${key.toPublicKey().toHex()}.json`),
          JSON.stringify(keystore.toObject(), null, 2)
        );
      }
    },
    cli: {
      command: LODESTAR_BINARY_PATH,
      args: ["validator", "--rcConfig", join(rootDir, "rc_config.json")],
      env: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        DEBUG: "*,-winston:*",
      },
    },
    logs: {
      stdoutFilePath: opts.logFilePath,
    },
    health: async () => {
      try {
        await callHttp(`http://${address}:${keyManagerPort}/eth/v1/keystores`, "GET");
        return true;
      } catch (err) {
        return false;
      }
    },
  };
};

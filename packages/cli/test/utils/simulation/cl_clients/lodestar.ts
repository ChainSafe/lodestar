import {mkdir, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {Keystore} from "@chainsafe/bls-keystore";
import {nodeUtils} from "@lodestar/beacon-node/node";
import {LogLevel} from "@lodestar/utils";
import {IBeaconArgs} from "../../../../src/cmds/beacon/options.js";
import {IValidatorCliArgs} from "../../../../src/cmds/validator/options.js";
import {IGlobalArgs} from "../../../../src/options/globalOptions.js";
import {JobOptions, CLClientGenerator, CLClientOptions, Runner, RunnerType, Job} from "../interfaces.js";
import {callHttp, LODESTAR_BINARY_PATH} from "../utils.js";

export const generateLodeStarBeaconNode: CLClientGenerator = (opts: CLClientOptions, runner: Runner): Job => {
  if (runner.type !== RunnerType.ChildProcess) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }
  const {rootDir, params, address, restPort, port, id, config, genesisStateFilePath} = opts;

  const {state} = nodeUtils.initDevState(config, params.validatorClients * params.validatorsPerClient, {
    genesisTime: params.genesisTime,
  });

  const rcConfig = ({
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    genesisStateFile: genesisStateFilePath,
    rest: true,
    "rest.address": address,
    "rest.port": restPort,
    "rest.namespace": "*",
    "sync.isSingleNode": params.beaconNodes === 1,
    "network.allowPublishToZeroPeers": params.beaconNodes === 1,
    eth1: false,
    discv5: params.beaconNodes > 1,
    "network.connectToDiscv5Bootnodes": params.beaconNodes > 1,
    "execution.engineMock": true,
    listenAddress: address,
    port: port,
    metrics: false,
    bootnodes: [],
    "params.SECONDS_PER_SLOT": String(params.secondsPerSlot),
    "params.GENESIS_DELAY": String(params.genesisSlotsDelay),
    "params.ALTAIR_FORK_EPOCH": String(params.altairEpoch),
    "params.BELLATRIX_FORK_EPOCH": String(params.bellatrixEpoch),
    logPrefix: id,
    logFormatGenesisTime: `${params.genesisTime}`,
    logLevel: LogLevel.debug,
    logFileDailyRotate: 0,
  } as unknown) as IBeaconArgs & IGlobalArgs;

  const validatorClientsJobs: JobOptions[] = [];
  if (opts.secretKeys.length > 0) {
    for (let clientIndex = 0; clientIndex < params.validatorClients; clientIndex += 1) {
      validatorClientsJobs.push(
        generateLodeStarValidatorJobs(
          {
            ...opts,
            rootDir: join(rootDir, `validator-${clientIndex}`),
            id: `${id}-validator-${clientIndex}`,
            logFilePath: join(dirname(opts.logFilePath), `${id}-validator-${clientIndex}.log`),
          },
          runner
        )
      );
    }
  }

  return runner.create(id, [
    {
      bootstrap: async () => {
        await mkdir(rootDir);
        await writeFile(join(rootDir, "genesis.ssz"), state.serialize());
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
          await callHttp(`http://${address}:${restPort}/eth/v1/node/health`);
          return true;
        } catch {
          return false;
        }
      },
      children: validatorClientsJobs,
    },
  ]);
};

export const generateLodeStarValidatorJobs = (opts: CLClientOptions, runner: Runner): JobOptions => {
  if (runner.type !== RunnerType.ChildProcess) {
    throw new Error(`Runner "${runner.type}" not yet supported.`);
  }

  const {rootDir, id, address, params, keyManagerPort, secretKeys, restPort} = opts;

  const rcConfig = ({
    network: "dev",
    preset: "minimal",
    dataDir: rootDir,
    server: `http://${address}:${restPort}/`,
    keymanager: true,
    "keymanager.authEnabled": false,
    "keymanager.address": address,
    "keymanager.port": keyManagerPort,
    "params.SECONDS_PER_SLOT": String(params.secondsPerSlot),
    "params.GENESIS_DELAY": String(params.genesisSlotsDelay),
    "params.ALTAIR_FORK_EPOCH": String(params.altairEpoch),
    "params.BELLATRIX_FORK_EPOCH": String(params.bellatrixEpoch),
    logPrefix: id,
    logFormatGenesisTime: params.genesisTime,
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
      for (const key of secretKeys.slice(secretKeys.length * params.externalKeysPercentage)) {
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
        await callHttp(`http://${address}:${keyManagerPort}/eth/v1/keystores`);
        return true;
      } catch (err) {
        return false;
      }
    },
  };
};

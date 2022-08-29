import {ChildProcess} from "node:child_process";
import {mkdir, writeFile} from "node:fs/promises";
import {nodeUtils} from "@lodestar/beacon-node/node";
import type {SecretKey} from "@chainsafe/bls/types";
import {Api, getClient} from "@lodestar/api";
import {Keystore} from "@chainsafe/bls-keystore";
import {interopSecretKey} from "@lodestar/state-transition";
import {IBeaconArgs} from "../../../src/cmds/beacon/options.js";
import {getBeaconConfigFromArgs} from "../../../src/config/beaconParams.js";
import {IGlobalArgs} from "../../../src/options/globalOptions.js";
import {IValidatorCliArgs} from "../../../lib/cmds/validator/options.js";
import {BeaconNodeConstructor, BeaconNodeProcess, SimulationParams} from "./types.js";
import {closeChildProcess, spawnProcessAndWait, __dirname} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LodestarBeaconNodeProcess: BeaconNodeConstructor = class LodestarBeaconNodeProcess
  implements BeaconNodeProcess {
  static totalProcessCount = 0;
  readonly params: SimulationParams;
  api!: Api;
  readonly secretKeys: Record<number, SecretKey[]> = {};
  readonly address: string;
  readonly port: number;
  readonly restPort: number;

  private rootDir: string;
  private beaconProcess!: ChildProcess;
  private validatorProcesses: ChildProcess[] = [];
  private beaconCliArgs: IBeaconArgs & IGlobalArgs;
  private validatorCliArgs: IValidatorCliArgs & IGlobalArgs;

  constructor(params: SimulationParams, rootDir: string) {
    this.params = params;
    this.rootDir = rootDir;
    LodestarBeaconNodeProcess.totalProcessCount += 1;

    this.address = "127.0.0.1";
    this.port = 4000 + LodestarBeaconNodeProcess.totalProcessCount;
    this.restPort = 5000 + LodestarBeaconNodeProcess.totalProcessCount;

    this.beaconCliArgs = ({
      network: "dev",
      preset: "minimal",
      dataDir: this.rootDir,
      genesisStateFile: `${this.rootDir}/genesis.ssz`,
      paramsFile: `${this.rootDir}/params.json`,
      rest: true,
      "rest.address": this.address,
      "rest.port": this.restPort,
      "sync.isSingleNode": true,
      "network.allowPublishToZeroPeers": true,
      eth1: false,
      discv5: false,
      listenAddress: this.address,
      port: this.port,
      metrics: false,
    } as unknown) as IBeaconArgs & IGlobalArgs;

    this.validatorCliArgs = ({
      network: "dev",
      preset: "minimal",
      dataDir: this.rootDir,
      paramsFile: `${this.rootDir}/params.json`,
      server: `http://${this.address}:${this.restPort}`,
    } as unknown) as IValidatorCliArgs & IGlobalArgs;
  }

  async start(): Promise<void> {
    await mkdir(this.rootDir);

    await this.createParamsFile();
    await this.createStateFile();

    this.api = getClient(
      {baseUrl: `http://${this.address}:${this.restPort}/`},
      {config: getBeaconConfigFromArgs(this.beaconCliArgs)}
    );

    await writeFile(`${this.rootDir}/beacon_config.json`, JSON.stringify(this.beaconCliArgs, null, 2));
    this.beaconProcess = await spawnProcessAndWait(
      `${__dirname}/../../../bin/lodestar.js`,
      ["beacon", "--rcConfig", `${this.rootDir}/beacon_config.json`, "--network", "dev"],
      async () => this.ready()
    );

    for (let clientIndex = 0; clientIndex < this.params.validatorClients; clientIndex++) {
      const validatorSecretKeys = Array.from({length: this.params.validatorsPerClient}, (_, i) =>
        interopSecretKey(clientIndex * this.params.validatorsPerClient + i)
      );
      this.secretKeys[clientIndex] = validatorSecretKeys;

      await mkdir(`${this.rootDir}/validator_${clientIndex}`);
      await mkdir(`${this.rootDir}/validator_${clientIndex}/keystores`);

      await writeFile(`${this.rootDir}/validator_${clientIndex}/password.txt`, "password");

      await writeFile(
        `${this.rootDir}/validator_${clientIndex}/config.json`,
        JSON.stringify(this.validatorCliArgs, null, 2)
      );

      for (const key of validatorSecretKeys) {
        const keystore = await Keystore.create("password", key.toBytes(), key.toPublicKey().toBytes(), "");
        await writeFile(
          `${this.rootDir}/validator_${clientIndex}/keystores/${key.toPublicKey().toHex()}.json`,
          JSON.stringify(keystore.toObject(), null, 2)
        );
      }

      this.validatorProcesses.push(
        await spawnProcessAndWait(
          `${__dirname}/../../../bin/lodestar.js`,
          [
            "validator",
            "--network",
            "dev",
            "--rcConfig",
            `${this.rootDir}/validator_${clientIndex}/config.json`,
            "--importKeystores",
            `${this.rootDir}/validator_${clientIndex}/keystores`,
            "--importKeystoresPassword",
            `${this.rootDir}/validator_${clientIndex}/password.txt`,
          ],
          // TODO: Add different check for validator health
          async () => this.ready()
        )
      );
    }
  }

  async stop(): Promise<void> {
    if (this.beaconProcess !== undefined) {
      await closeChildProcess(this.beaconProcess);
    }

    await Promise.all(this.validatorProcesses.map((p) => closeChildProcess(p)));
  }

  async ready(): Promise<boolean> {
    const health = await this.api.node.getHealth();

    return health === 200 || health === 206;
  }

  private async createParamsFile(): Promise<void> {
    const paramsFile = `${this.rootDir}/params.json`;
    const paramsAsStringValues: Record<string, unknown> = {};
    for (const key of (Object.keys(this.params) as unknown) as keyof SimulationParams) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      paramsAsStringValues[key] = String(this.params[key]);
    }
    await writeFile(paramsFile, JSON.stringify(paramsAsStringValues, null, 2));
  }

  private async createStateFile(): Promise<void> {
    const config = getBeaconConfigFromArgs(this.beaconCliArgs);
    const {state} = nodeUtils.initDevState(config, this.params.validatorClients, {
      genesisTime: this.params.genesisTime,
    });
    await writeFile(`${this.rootDir}/genesis.ssz`, state.serialize());
  }
};

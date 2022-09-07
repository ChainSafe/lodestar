import {ChildProcess} from "node:child_process";
import {mkdir, writeFile} from "node:fs/promises";
import type {SecretKey} from "@chainsafe/bls/types";
import {Api, getClient} from "@lodestar/api/keymanager";
import {Keystore} from "@chainsafe/bls-keystore";
import {IChainForkConfig} from "@lodestar/config";
import {interopSecretKey} from "@lodestar/state-transition";
import {IGlobalArgs} from "../../../src/options/globalOptions.js";
import {IValidatorCliArgs} from "../../../lib/cmds/validator/options.js";
import {SimulationParams, ValidatorConstructor, ValidatorProcess} from "./types.js";
import {closeChildProcess, spawnProcessAndWait, __dirname} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LodestarValidatorProcess: ValidatorConstructor = class LodestarValidatorProcess
  implements ValidatorProcess {
  static totalProcessCount = 0;
  readonly params: SimulationParams;
  readonly address = "127.0.0.1";
  readonly keyManagerPort: number;
  readonly id: string;
  keyManagerApi!: Api;
  secretKeys: SecretKey[] = [];

  private rootDir: string;
  private clientIndex: number;
  private validatorProcess!: ChildProcess;
  private rcConfig: IValidatorCliArgs & IGlobalArgs;
  private forkConfig: IChainForkConfig;

  constructor(
    params: SimulationParams,
    {
      rootDir,
      clientIndex,
      server,
      config,
    }: {
      rootDir: string;
      clientIndex: number;
      server: string;
      config: IChainForkConfig;
    }
  ) {
    this.params = params;
    this.rootDir = rootDir;
    this.clientIndex = clientIndex;
    LodestarValidatorProcess.totalProcessCount += 1;

    this.keyManagerPort = 6000 + LodestarValidatorProcess.totalProcessCount;
    this.id = `VAL-${LodestarValidatorProcess.totalProcessCount}`;
    this.forkConfig = config;

    this.rcConfig = ({
      network: "dev",
      preset: "minimal",
      dataDir: this.rootDir,
      server,
      keymanager: true,
      "keymanager.authEnabled": false,
      "keymanager.address": this.address,
      "keymanager.port": this.keyManagerPort,
      "params.SECONDS_PER_SLOT": String(this.params.secondsPerSlot),
      "params.GENESIS_DELAY": String(this.params.genesisSlotsDelay),
      "params.ALTAIR_FORK_EPOCH": String(this.params.altairEpoch),
      "params.BELLATRIX_FORK_EPOCH": String(this.params.bellatrixEpoch),
      logFormatId: `VAL-${LodestarValidatorProcess.totalProcessCount}`,
      logFormatGenesisTime: this.id,
    } as unknown) as IValidatorCliArgs & IGlobalArgs;
  }

  async start(): Promise<void> {
    this.keyManagerApi = getClient(
      {baseUrl: `http://${this.address}:${this.keyManagerPort}/`},
      {config: this.forkConfig}
    );

    const validatorSecretKeys = Array.from({length: this.params.validatorsPerClient}, (_, i) =>
      interopSecretKey(this.clientIndex * this.params.validatorsPerClient + i)
    );
    this.secretKeys = validatorSecretKeys;
    await mkdir(this.rootDir);
    await mkdir(`${this.rootDir}/keystores`);

    await writeFile(`${this.rootDir}/password.txt`, "password");

    await writeFile(`${this.rootDir}/rc_config.json`, JSON.stringify(this.rcConfig, null, 2));

    for (const key of validatorSecretKeys) {
      const keystore = await Keystore.create("password", key.toBytes(), key.toPublicKey().toBytes(), "");
      await writeFile(
        `${this.rootDir}/keystores/${key.toPublicKey().toHex()}.json`,
        JSON.stringify(keystore.toObject(), null, 2)
      );
    }

    console.log(`Starting validator at: ${this.rootDir}`);
    console.log(`Validator config: ${JSON.stringify(this.rcConfig, null, 2)}`);

    this.validatorProcess = await spawnProcessAndWait(
      `${__dirname}/../../../bin/lodestar.js`,
      [
        "validator",
        "--network",
        "dev",
        "--rcConfig",
        `${this.rootDir}/rc_config.json`,
        "--importKeystores",
        `${this.rootDir}/keystores`,
        "--importKeystoresPassword",
        `${this.rootDir}/password.txt`,
      ],
      async () => this.ready(),
      "Waiting for validator to start..."
    );
  }

  async stop(): Promise<void> {
    if (this.validatorProcess !== undefined) {
      await closeChildProcess(this.validatorProcess);
    }
  }

  async ready(): Promise<boolean> {
    try {
      await this.keyManagerApi.listKeys();
      return true;
    } catch {
      return false;
    }
  }
};

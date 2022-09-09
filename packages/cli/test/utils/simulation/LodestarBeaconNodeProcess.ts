import {ChildProcess} from "node:child_process";
import {mkdir, writeFile} from "node:fs/promises";
import type {SecretKey} from "@chainsafe/bls/types";
import {Api, getClient} from "@lodestar/api";
import {nodeUtils} from "@lodestar/beacon-node/node";
import {IChainForkConfig} from "@lodestar/config";
import {IBeaconArgs} from "../../../src/cmds/beacon/options.js";
import {getBeaconConfigFromArgs} from "../../../src/config/beaconParams.js";
import {IGlobalArgs} from "../../../src/options/globalOptions.js";
import {LodestarValidatorProcess} from "./LodestarValidatorProcess.js";
import {BeaconNodeConstructor, BeaconNodeProcess, SimulationParams, ValidatorProcess} from "./types.js";
import {closeChildProcess, logFilesDir, spawnProcessAndWait, __dirname} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LodestarBeaconNodeProcess: BeaconNodeConstructor = class LodestarBeaconNodeProcess
  implements BeaconNodeProcess {
  static totalProcessCount = 0;
  readonly params: SimulationParams;
  readonly secretKeys: Record<number, SecretKey[]> = {};
  readonly address: string;
  readonly port: number;
  readonly restPort: number;
  readonly id: string;
  api!: Api;
  peerId!: string;
  multiaddrs!: string[];
  validatorClients: ValidatorProcess[] = [];

  private rootDir: string;
  private beaconProcess!: ChildProcess;

  private rcConfig: IBeaconArgs & IGlobalArgs;
  private config!: IChainForkConfig;

  constructor(params: SimulationParams, rootDir: string) {
    this.params = params;
    this.rootDir = rootDir;
    LodestarBeaconNodeProcess.totalProcessCount += 1;

    this.address = "127.0.0.1";
    this.port = 4000 + LodestarBeaconNodeProcess.totalProcessCount;
    this.restPort = 5000 + LodestarBeaconNodeProcess.totalProcessCount;
    this.id = `NODE-${LodestarBeaconNodeProcess.totalProcessCount}`;

    this.rcConfig = ({
      network: "dev",
      preset: "minimal",
      dataDir: this.rootDir,
      genesisStateFile: `${this.rootDir}/genesis.ssz`,
      rest: true,
      "rest.address": this.address,
      "rest.port": this.restPort,
      "rest.namespace": "*",
      "sync.isSingleNode": this.params.beaconNodes === 1,
      "network.allowPublishToZeroPeers": true,
      eth1: false,
      discv5: this.params.beaconNodes > 1,
      "network.connectToDiscv5Bootnodes": this.params.beaconNodes > 1,
      "execution.engineMock": true,
      listenAddress: this.address,
      port: this.port,
      metrics: false,
      bootnodes: [],
      "params.SECONDS_PER_SLOT": String(this.params.secondsPerSlot),
      "params.GENESIS_DELAY": String(this.params.genesisSlotsDelay),
      "params.ALTAIR_FORK_EPOCH": String(this.params.altairEpoch),
      "params.BELLATRIX_FORK_EPOCH": String(this.params.bellatrixEpoch),
      logPrefix: this.id,
      logFormatGenesisTime: `${this.params.genesisTime}`,
      logFile: `${this.params.logFilesDir}/${this.id}.log`,
      logFileLevel: "debug",
      logLevel: process.env.SHOW_LOGS ? "info" : "error",
    } as unknown) as IBeaconArgs & IGlobalArgs;

    for (let clientIndex = 0; clientIndex < this.params.validatorClients; clientIndex++) {
      this.validatorClients.push(
        new LodestarValidatorProcess(this.params, {
          rootDir: `${this.rootDir}/validator-${clientIndex}`,
          config: getBeaconConfigFromArgs(this.rcConfig).config,
          server: `http://${this.address}:${this.restPort}/`,
          clientIndex,
        })
      );
    }
  }

  async start(): Promise<void> {
    this.multiaddrs = [`/ip4/${this.address}/tcp/${this.port}`];
    this.config = getBeaconConfigFromArgs(this.rcConfig).config;
    this.api = getClient({baseUrl: `http://${this.address}:${this.restPort}`}, {config: this.config});

    const {state} = nodeUtils.initDevState(
      this.config,
      this.params.validatorClients * this.params.validatorsPerClient,
      {
        genesisTime: this.params.genesisTime,
      }
    );

    await mkdir(this.rootDir);
    await writeFile(`${this.rootDir}/genesis.ssz`, state.serialize());
    await writeFile(`${this.rootDir}/rc_config.json`, JSON.stringify(this.rcConfig, null, 2));

    console.log(`Starting beacon node at: ${this.rootDir}`);
    console.log(`Beacon node config: ${JSON.stringify(this.rcConfig, null, 2)}`);

    this.beaconProcess = await spawnProcessAndWait(
      `${__dirname}/../../../bin/lodestar.js`,
      ["beacon", "--rcConfig", `${this.rootDir}/rc_config.json`, "--network", "dev"],
      async () => this.ready(),
      "Waiting for beacon node to start..."
    );

    console.log(`Beacon node "${this.id}" started.`);

    this.peerId = (await this.api.node.getNetworkIdentity()).data.peerId;

    for (let clientIndex = 0; clientIndex < this.params.validatorClients; clientIndex++) {
      await this.validatorClients[clientIndex].start();
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.validatorClients.map((p) => p.stop()));

    if (this.beaconProcess !== undefined) {
      await closeChildProcess(this.beaconProcess);
    }
  }

  async ready(): Promise<boolean> {
    const health = await this.api.node.getHealth();

    return health === 200 || health === 206;
  }
};

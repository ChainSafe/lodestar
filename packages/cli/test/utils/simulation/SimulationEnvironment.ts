/* eslint-disable @typescript-eslint/naming-convention */
import {EventEmitter} from "node:events";
import fs from "node:fs";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import tmp from "tmp";
import {fromHexString} from "@chainsafe/ssz";
import {nodeUtils} from "@lodestar/beacon-node";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {activePreset} from "@lodestar/params";
import {BeaconStateAllForks, interopSecretKey} from "@lodestar/state-transition";
import {EpochClock, MS_IN_SEC} from "./EpochClock.js";
import {ExternalSignerServer} from "./ExternalSignerServer.js";
import {SimulationTracker} from "./SimulationTracker.js";
import {createCLNode} from "./cl_clients/index.js";
import {
  CLIQUE_SEALING_PERIOD,
  MOCK_ETH1_GENESIS_HASH,
  SIM_ENV_CHAIN_ID,
  SIM_ENV_NETWORK_ID,
  SIM_TESTS_SECONDS_PER_SLOT,
} from "./constants.js";
import {createELNode} from "./el_clients/index.js";
import {
  CLClient,
  CLClientKeys,
  ELClient,
  IRunner,
  NodePair,
  NodePairOptions,
  SimulationInitOptions,
  SimulationOptions,
} from "./interfaces.js";
import {Runner} from "./runner/index.js";
import {getEstimatedTTD, registerProcessHandler, replaceIpFromUrl} from "./utils/index.js";
import {getCLNodePaths, getELNodePaths} from "./utils/paths.js";

interface StartOpts {
  runTimeoutMs: number;
}

/* eslint-disable no-console */

export class SimulationEnvironment {
  readonly nodes: NodePair[] = [];
  readonly clock: EpochClock;
  readonly tracker: SimulationTracker;
  readonly emitter: EventEmitter;
  readonly runner: IRunner;
  readonly externalSigner: ExternalSignerServer;

  readonly forkConfig: ChainForkConfig;
  readonly options: SimulationOptions;

  private keysCount = 0;
  private nodePairCount = 0;
  private genesisState?: BeaconStateAllForks;

  private constructor(forkConfig: ChainForkConfig, options: SimulationOptions) {
    this.forkConfig = forkConfig;
    this.options = options;

    this.clock = new EpochClock({
      genesisTime: this.options.elGenesisTime + this.forkConfig.GENESIS_DELAY,
      secondsPerSlot: this.forkConfig.SECONDS_PER_SLOT,
      slotsPerEpoch: activePreset.SLOTS_PER_EPOCH,
      signal: this.options.controller.signal,
    });

    this.emitter = new EventEmitter();
    this.externalSigner = new ExternalSignerServer([]);
    this.runner = new Runner({logsDir: this.options.logsDir});
    this.tracker = SimulationTracker.initWithDefaultAssertions({
      nodes: [],
      config: this.forkConfig,
      clock: this.clock,
      signal: this.options.controller.signal,
    });
  }

  static async initWithDefaults(
    {chainConfig, logsDir, id}: SimulationInitOptions,
    clients: NodePairOptions[]
  ): Promise<SimulationEnvironment> {
    const secondsPerSlot = chainConfig.SECONDS_PER_SLOT ?? SIM_TESTS_SECONDS_PER_SLOT;
    const genesisTime = Math.floor(Date.now() / 1000);
    const ttd =
      chainConfig.TERMINAL_TOTAL_DIFFICULTY ??
      getEstimatedTTD({
        genesisDelaySeconds: chainConfig.GENESIS_DELAY,
        bellatrixForkEpoch: chainConfig.BELLATRIX_FORK_EPOCH,
        secondsPerSlot: secondsPerSlot,
        cliqueSealingPeriod: CLIQUE_SEALING_PERIOD,
        // Make sure bellatrix started before TTD reach, so we wait for few more slots to be sure
        additionalSlots: activePreset.SLOTS_PER_EPOCH - 2,
      });

    const forkConfig = createChainForkConfig({
      ...chainConfig,
      SECONDS_PER_SLOT: secondsPerSlot,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
      DEPOSIT_CHAIN_ID: SIM_ENV_CHAIN_ID,
      DEPOSIT_NETWORK_ID: SIM_ENV_NETWORK_ID,
      SECONDS_PER_ETH1_BLOCK: CLIQUE_SEALING_PERIOD,
      ETH1_FOLLOW_DISTANCE: 1,
    });

    const env = new SimulationEnvironment(forkConfig, {
      logsDir,
      id,
      elGenesisTime: genesisTime,
      controller: new AbortController(),
      rootDir: path.join(tmp.dirSync({unsafeCleanup: true, tmpdir: "/tmp", template: "sim-XXXXXX"}).name, id),
    });

    for (const client of clients) {
      env.nodes.push(await env.createNodePair(client));
    }

    return env;
  }

  async start(opts: StartOpts): Promise<void> {
    const currentTime = Date.now();
    setTimeout(() => {
      const slots = this.clock.getSlotFor((currentTime + opts.runTimeoutMs) / MS_IN_SEC);
      const epoch = this.clock.getEpochForSlot(slots);
      const slot = this.clock.getSlotIndexInEpoch(slots);

      this.stop(1, `Sim run timedout in ${opts.runTimeoutMs}ms (approx. ${epoch}/${slot}).`).catch((e) =>
        console.error("Error on stop", e)
      );
    }, opts.runTimeoutMs);

    const msToGenesis = this.clock.msToGenesis();
    const startTimeout = setTimeout(() => {
      const slots = this.clock.getSlotFor((currentTime + msToGenesis) / MS_IN_SEC);
      const epoch = this.clock.getEpochForSlot(slots);
      const slot = this.clock.getSlotIndexInEpoch(slots);

      this.stop(
        1,
        `Start sequence not completed before genesis, in ${msToGenesis}ms (approx. ${epoch}/${slot}).`
      ).catch((e) => console.error("Error on stop", e));
    }, msToGenesis);

    try {
      registerProcessHandler(this);
      if (!fs.existsSync(this.options.rootDir)) {
        await mkdir(this.options.rootDir);
      }

      await this.runner.start();
      await Promise.all(this.nodes.map((node) => node.el.job.start()));

      await this.initGenesisState();
      if (!this.genesisState) {
        throw new Error("The genesis state for CL clients is not defined.");
      }

      await Promise.all(this.nodes.map((node) => node.cl.job.start()));

      if (this.nodes.some((node) => node.cl.keys.type === "remote")) {
        console.log("Starting external signer...");
        await this.externalSigner.start();
        console.log("Started external signer");

        for (const node of this.nodes) {
          if (node.cl.keys.type === "remote") {
            this.externalSigner.addKeys(node.cl.keys.secretKeys);
            await node.cl.keyManager.importRemoteKeys(
              node.cl.keys.secretKeys.map((sk) => ({pubkey: sk.toPublicKey().toHex(), url: this.externalSigner.url}))
            );
            console.log(`Imported remote keys for node ${node.id}`);
          }
        }
      }

      await this.tracker.start();
      await Promise.all(this.nodes.map((node) => this.tracker.track(node)));
    } catch (error) {
      await this.stop(1, `Error in startup. ${(error as Error).stack}`);
    } finally {
      clearTimeout(startTimeout);
    }
  }

  async stop(code = 0, message = "On completion."): Promise<void> {
    process.removeAllListeners("unhandledRejection");
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    console.log(`Simulation environment "${this.options.id}" is stopping: ${message}`);
    await this.tracker.stop();
    await Promise.all(this.nodes.map((node) => node.el.job.stop()));
    await Promise.all(this.nodes.map((node) => node.cl.job.stop()));
    await this.externalSigner.stop();
    await this.runner.stop();
    this.options.controller.abort();

    if (this.tracker.getErrorCount() > 0) {
      this.tracker.reporter.summary();
      process.exit(this.tracker.getErrorCount() > 0 ? 1 : code);
    } else {
      process.exit(code);
    }
  }

  async createNodePair<C extends CLClient, E extends ELClient>({
    el,
    cl,
    keysCount,
    id,
    remote,
    mining,
  }: NodePairOptions<C, E>): Promise<NodePair> {
    if (this.genesisState && keysCount > 0) {
      throw new Error("Genesis state already initialized. Can not add more keys to it.");
    }
    const interopKeys = Array.from({length: keysCount}, (_, vi) => {
      return interopSecretKey(this.keysCount + vi);
    });
    this.keysCount += keysCount;

    const keys: CLClientKeys =
      interopKeys.length > 0 && remote
        ? {type: "remote", secretKeys: interopKeys}
        : interopKeys.length > 0
        ? {type: "local", secretKeys: interopKeys}
        : {type: "no-keys"};

    const elType = typeof el === "object" ? el.type : el;
    const clType = typeof cl === "object" ? cl.type : cl;

    const elOptions = typeof el === "object" ? el.options : {};
    const elNode = await createELNode(elType, {
      ...elOptions,
      id,
      mining,
      nodeIndex: this.nodePairCount,
      forkConfig: this.forkConfig,
      runner: this.runner,
      paths: getELNodePaths({
        root: this.options.rootDir,
        id,
        client: elType,
        logsDir: this.options.logsDir,
      }),
      genesisTime: this.options.elGenesisTime,
    });

    const clOptions = typeof cl === "object" ? cl.options : {};
    const engineUrls = [
      // As lodestar is running on host machine, need to connect through local exposed ports
      clType === CLClient.Lodestar ? replaceIpFromUrl(elNode.engineRpcUrl, "127.0.0.1") : elNode.engineRpcUrl,
      ...(clOptions.engineUrls || []),
    ];

    const clNode = await createCLNode(clType, {
      ...clOptions,
      id,
      keys,
      engineMock: typeof el === "string" ? el === ELClient.Mock : el.type === ELClient.Mock,
      engineUrls,
      nodeIndex: this.nodePairCount,
      config: this.forkConfig,
      runner: this.runner,
      genesisTime: this.options.elGenesisTime,
      clientOptions: clOptions,
      genesisState: this.genesisState,
      paths: getCLNodePaths({
        root: this.options.rootDir,
        id,
        client: clType,
        logsDir: this.options.logsDir,
      }),
    });

    this.nodePairCount += 1;

    return {id, el: elNode, cl: clNode};
  }

  private async initGenesisState(): Promise<void> {
    for (let i = 0; i < this.nodes.length; i++) {
      // Get genesis block hash
      const el = this.nodes[i].el;

      // If eth1 is mock then genesis hash would be empty
      const eth1Genesis = el.provider === null ? {hash: MOCK_ETH1_GENESIS_HASH} : await el.provider.getBlockByNumber(0);

      if (!eth1Genesis) {
        throw new Error(`Eth1 genesis not found for node "${this.nodes[i].id}"`);
      }

      const genesisState = nodeUtils.initDevState(this.forkConfig, this.keysCount, {
        genesisTime: this.options.elGenesisTime + this.forkConfig.GENESIS_DELAY,
        eth1BlockHash: fromHexString(eth1Genesis.hash),
      }).state;

      this.genesisState = genesisState;

      // Write the genesis state for all nodes
      for (const node of this.nodes) {
        const {genesisFilePath} = getCLNodePaths({
          root: this.options.rootDir,
          id: node.id,
          logsDir: this.options.logsDir,
          client: node.cl.client,
        });
        await writeFile(genesisFilePath, this.genesisState.serialize());
      }
    }
  }
}

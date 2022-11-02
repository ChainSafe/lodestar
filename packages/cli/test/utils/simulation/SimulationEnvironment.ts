/* eslint-disable @typescript-eslint/naming-convention */
import {mkdir, rm, writeFile} from "node:fs/promises";
import {EventEmitter} from "node:events";
import {join} from "node:path";
import tmp from "tmp";
import {routes} from "@lodestar/api/beacon";
import {nodeUtils} from "@lodestar/beacon-node";
import {createIChainForkConfig, IChainForkConfig} from "@lodestar/config";
import {activePreset, MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {BeaconStateAllForks, interopSecretKey} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {generateLodestarBeaconNode} from "./cl_clients/lodestar.js";
import {EpochClock} from "./EpochClock.js";
import {ExternalSignerServer} from "./ExternalSignerServer.js";
import {
  AtLeast,
  CLClient,
  CLClientOptions,
  CLNode,
  NodePairResult,
  ELClient,
  ELClientOptions,
  ELNode,
  ELStartMode,
  Job,
  NodePair,
  NodePairOptions,
  Runner,
  RunnerType,
  SimulationInitOptions,
  SimulationOptions,
} from "./interfaces.js";
import {ChildProcessRunner} from "./runner/child_process.js";
import {SimulationTracker} from "./SimulationTracker.js";
import {
  BN_P2P_BASE_PORT,
  BN_REST_BASE_PORT,
  CLIQUE_SEALING_PERIOD,
  EL_ENGINE_BASE_PORT,
  EL_ETH_BASE_PORT,
  EL_P2P_BASE_PORT,
  KEY_MANAGER_BASE_PORT,
  SIM_TESTS_SECONDS_PER_SLOT,
} from "./constants.js";
import {generateGethNode} from "./el_clients/geth.js";
import {getEstimatedTTD} from "./utils.js";

export const SHARED_JWT_SECRET = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";

/* eslint-disable no-console */

export class SimulationEnvironment {
  // Tests related properties
  readonly expectedMinParticipationRate = 0.9;
  readonly expectedMaxInclusionDelay = 2;
  readonly expectedMinAttestationCount = MAX_COMMITTEES_PER_SLOT - 1;
  readonly expectedMinSyncParticipationRate = 0.9;

  readonly nodes: NodePair[] = [];
  readonly clock: EpochClock;
  readonly tracker: SimulationTracker;
  readonly emitter: EventEmitter;
  readonly runner: Runner;
  readonly externalSigner: ExternalSignerServer;
  readonly externalKeysPercentage = 0.5;

  readonly forkConfig: IChainForkConfig;
  readonly options: SimulationOptions;

  private readonly jobs: {cl: Job; el: Job}[] = [];
  private keysCount = 0;
  private nodePairCount = 0;
  private genesisState?: BeaconStateAllForks;
  private genesisStatePath: string;

  readonly network = {
    connectAllNodes: async (): Promise<void> => {
      for (const node1 of this.nodes) {
        for (const node2 of this.nodes) {
          const networkIdentity = (await node1.cl.api.node.getNetworkIdentity()).data;

          if (node1 === node2 || !networkIdentity.peerId) continue;

          await node2.cl.api.lodestar.connectPeer(networkIdentity.peerId, networkIdentity.p2pAddresses);
        }
      }
    },

    connectNewNode: async (newNode: NodePair): Promise<void> => {
      for (const node of this.nodes) {
        const networkIdentity = (await node.cl.api.node.getNetworkIdentity()).data;
        await newNode.cl.api.lodestar.connectPeer(networkIdentity.peerId, networkIdentity.p2pAddresses);
      }
    },
  };

  private constructor(forkConfig: IChainForkConfig, options: SimulationOptions) {
    this.forkConfig = forkConfig;
    this.options = options;
    this.genesisStatePath = join(this.options.rootDir, "genesis.ssz");

    this.clock = new EpochClock({
      genesisTime: this.options.genesisTime,
      secondsPerSlot: this.forkConfig.SECONDS_PER_SLOT,
      slotsPerEpoch: activePreset.SLOTS_PER_EPOCH,
      signal: this.options.controller.signal,
    });

    this.emitter = new EventEmitter();
    this.externalSigner = new ExternalSignerServer([]);

    if (this.options.runnerType === RunnerType.ChildProcess) {
      this.runner = new ChildProcessRunner();
    } else {
      throw new Error("Invalid runner type");
    }

    this.tracker = new SimulationTracker([], this.forkConfig, this.clock, this.options.controller.signal);
  }

  static initWithDefaults(
    {chainConfig, logsDir, id}: SimulationInitOptions,
    clients: NodePairOptions[]
  ): SimulationEnvironment {
    const secondsPerSlot = chainConfig.SECONDS_PER_SLOT ?? SIM_TESTS_SECONDS_PER_SLOT;
    const ttd =
      chainConfig.TERMINAL_TOTAL_DIFFICULTY ??
      getEstimatedTTD({
        genesisDelay: chainConfig.GENESIS_DELAY,
        bellatrixForkEpoch: chainConfig.BELLATRIX_FORK_EPOCH,
        secondsPerSlot: secondsPerSlot,
        cliqueSealingPeriod: CLIQUE_SEALING_PERIOD,
        additionalSlots: 4, // Make sure bellatrix started before TTD reach
      });

    const genesisTime = Math.floor(Date.now() / 1000) + chainConfig.GENESIS_DELAY * secondsPerSlot;

    const forkConfig = createIChainForkConfig({
      ...chainConfig,
      SECONDS_PER_SLOT: secondsPerSlot,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
    });

    const env = new SimulationEnvironment(forkConfig, {
      logsDir,
      runnerType: RunnerType.ChildProcess,
      id,
      genesisTime,
      controller: new AbortController(),
      rootDir: join(tmp.dirSync({unsafeCleanup: true, tmpdir: "/tmp", template: "sim-XXXXXX"}).name, id),
    });

    for (const client of clients) {
      const result = env.createNodePair(client);
      env.jobs.push(result.jobs);
      env.nodes.push(result.nodePair);
    }

    return env;
  }

  async start(): Promise<void> {
    await mkdir(this.options.rootDir);

    await Promise.all(this.jobs.map((j) => j.el.start()));

    for (let i = 0; i < this.nodes.length; i++) {
      // Get genesis block hash
      const eth1Genesis = await this.nodes[i].el.provider.getBlockByNumber(0);
      if (!eth1Genesis) {
        throw new Error(`Eth1 genesis not found for node "${this.nodes[i].id}"`);
      }

      const genesisState = nodeUtils.initDevState(this.forkConfig, this.keysCount, {
        genesisTime: this.options.genesisTime,
        eth1BlockHash: fromHexString(eth1Genesis.hash),
      }).state;

      this.genesisState = genesisState;
    }

    if (!this.genesisState) {
      throw new Error("The genesis state for CL clients is not defined.");
    }

    await writeFile(this.genesisStatePath, this.genesisState.serialize());

    await Promise.all(this.jobs.map((j) => j.cl.start()));

    await this.externalSigner.start();
    for (const node of this.nodes) {
      const remoteKeys = node.cl.remoteKeys;
      this.externalSigner.addKeys(remoteKeys);
      await node.cl.keyManager.importRemoteKeys(
        remoteKeys.map((sk) => ({pubkey: sk.toPublicKey().toHex(), url: this.externalSigner.url}))
      );
    }

    await this.tracker.start();
    await Promise.all(this.nodes.map((node) => this.tracker.track(node)));
  }

  async stop(): Promise<void> {
    this.options.controller.abort();
    await this.tracker.stop();
    await Promise.all(this.jobs.map((j) => j.el.stop()));
    await Promise.all(this.jobs.map((j) => j.cl.stop()));
    await this.externalSigner.stop();
    await rm(this.options.rootDir, {recursive: true});
  }

  // TODO: Add timeout support
  waitForEvent(event: routes.events.EventType, node?: CLNode): Promise<routes.events.BeaconEvent> {
    console.log(`Waiting for event "${event}" on "${node?.id ?? "any node"}"`);

    return new Promise((resolve) => {
      const handler = (beaconEvent: routes.events.BeaconEvent, eventNode: CLNode): void => {
        if (!node) {
          this.emitter.removeListener(event, handler);
          resolve(beaconEvent);
        }

        if (node && eventNode === node) {
          this.emitter.removeListener(event, handler);
          resolve(beaconEvent);
        }
      };

      this.tracker.emitter.addListener(event, handler);
    });
  }

  async waitForSlot(slot: Slot, nodes?: NodePair[]): Promise<void> {
    console.log(`\nWaiting for slot on "${nodes ? nodes.map((n) => n.cl.id).join(",") : "all nodes"}"`, {
      target: slot,
      current: this.clock.currentSlot,
    });

    await Promise.all(
      (nodes ?? this.nodes).map(
        (node) =>
          new Promise((resolve) => {
            this.tracker.onSlot(slot, node, resolve);
          })
      )
    );
  }

  createNodePair({el, cl, keysCount, id, wssCheckpoint}: NodePairOptions): NodePairResult {
    if (this.genesisState && keysCount > 0) {
      throw new Error("Genesis state already initialized. Can not add more keys to it.");
    }

    this.nodePairCount += 1;

    const keys = Array.from({length: keysCount}, (_, vi) => {
      return interopSecretKey(this.keysCount + vi);
    });
    this.keysCount += keysCount;

    const clClient = this.createCLNode(cl, {
      id,
      remoteKeys: keys.slice(0, keys.length * this.externalKeysPercentage),
      localKeys: keys.slice(keys.length * this.externalKeysPercentage),
      wssCheckpoint,
    });

    const elClient = this.createELNode(el, {id});

    return {
      nodePair: {id, el: elClient.node, cl: clClient.node},
      jobs: {el: elClient.job, cl: clClient.job},
    };
  }

  private createCLNode(
    client: CLClient,
    options?: AtLeast<CLClientOptions, "remoteKeys" | "localKeys" | "id">
  ): {job: Job; node: CLNode} {
    const clId = `${options?.id}-cl-${client}`;

    switch (client) {
      case CLClient.Lodestar: {
        const opts: CLClientOptions = {
          id: clId,
          dataDir: join(this.options.rootDir, clId),
          logFilePath: join(this.options.logsDir, `${clId}.log`),
          genesisStateFilePath: this.genesisStatePath,
          restPort: BN_REST_BASE_PORT + this.nodePairCount + 1,
          port: BN_P2P_BASE_PORT + this.nodePairCount + 1,
          keyManagerPort: KEY_MANAGER_BASE_PORT + this.nodePairCount + 1,
          config: this.forkConfig,
          address: "127.0.0.1",
          remoteKeys: options?.remoteKeys ?? [],
          localKeys: options?.localKeys ?? [],
          genesisTime: this.options.genesisTime,
          engineUrl: options?.engineUrl ?? `http://127.0.0.1:${EL_ENGINE_BASE_PORT + this.nodePairCount + 1}`,
          jwtSecretHex: options?.jwtSecretHex ?? SHARED_JWT_SECRET,
        };
        return generateLodestarBeaconNode(opts, this.runner);
      }
      default:
        throw new Error(`CL Client "${client}" not supported`);
    }
  }

  private createELNode(client: ELClient, options: AtLeast<ELClientOptions, "id">): {job: Job; node: ELNode} {
    const elId = `${options.id}-el-${client}`;

    switch (client) {
      case ELClient.Geth: {
        const opts: ELClientOptions = {
          id: elId,
          mode:
            options?.mode ?? (this.forkConfig.BELLATRIX_FORK_EPOCH > 0 ? ELStartMode.PreMerge : ELStartMode.PostMerge),
          ttd: options?.ttd ?? this.forkConfig.TERMINAL_TOTAL_DIFFICULTY,
          cliqueSealingPeriod: options?.cliqueSealingPeriod ?? CLIQUE_SEALING_PERIOD,
          logFilePath: options?.logFilePath ?? join(this.options.logsDir, `${elId}.log`),
          dataDir: options?.dataDir ?? join(this.options.rootDir, elId),
          jwtSecretHex: options?.jwtSecretHex ?? SHARED_JWT_SECRET,
          enginePort: options?.enginePort ?? EL_ENGINE_BASE_PORT + this.nodePairCount + 1,
          ethPort: options?.ethPort ?? EL_ETH_BASE_PORT + this.nodePairCount + 1,
          port: options?.port ?? EL_P2P_BASE_PORT + this.nodePairCount + 1,
        };
        return generateGethNode(opts, this.runner);
      }
      default:
        throw new Error(`EL Client "${client}" not supported`);
    }
  }
}

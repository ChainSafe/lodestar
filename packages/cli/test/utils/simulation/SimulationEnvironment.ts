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
import {generateLodestarBeaconNode} from "./cl_clients/lodestar.js";
import {EpochClock} from "./EpochClock.js";
import {ExternalSignerServer} from "./ExternalSignerServer.js";
import {
  AtLeast,
  CLClient,
  CLClientOptions,
  CLNode,
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
  EL_ENGINE_BASE_PORT,
  EL_ETH_BASE_PORT,
  KEY_MANAGER_BASE_PORT,
} from "./utils.js";
import {generateGethNode} from "./el_clients/geth.js";

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

  genesisState?: BeaconStateAllForks;
  readonly forkConfig: IChainForkConfig;
  readonly options: SimulationOptions;

  private readonly jobs: Job[] = [];
  private keysCount = 0;

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

    this.tracker = new SimulationTracker(this.nodes, this.forkConfig, this.clock, this.options.controller.signal);
  }

  static initWithDefaults(
    {chainConfig, logsDir, id}: SimulationInitOptions,
    clients: NodePairOptions[]
  ): SimulationEnvironment {
    const forkConfig = createIChainForkConfig({
      ...chainConfig,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      SECONDS_PER_SLOT: chainConfig.SECONDS_PER_SLOT ?? 4,
    });

    const genesisTime = Math.floor(Date.now() / 1000) + forkConfig.GENESIS_DELAY * forkConfig.SECONDS_PER_SLOT;

    const env = new SimulationEnvironment(forkConfig, {
      logsDir,
      runnerType: RunnerType.ChildProcess,
      id,
      genesisTime,
      controller: new AbortController(),
      rootDir: join(tmp.dirSync({unsafeCleanup: true, tmpdir: "/tmp", template: "sim-XXXXXX"}).name, id),
    });

    for (const client of clients) {
      const result = env.createClientPair(client);

      env.jobs.push(result.el.job);
      env.jobs.push(result.cl.job);

      env.nodes.push({id: client.id, cl: result.cl.node, el: result.el.node});
    }

    return env;
  }

  async start(): Promise<void> {
    await mkdir(this.options.rootDir);
    this.genesisState = nodeUtils.initDevState(this.forkConfig, this.keysCount, {
      genesisTime: this.options.genesisTime,
    }).state;

    const genesisStateFilePath = join(this.options.rootDir, "genesis.ssz");
    await writeFile(genesisStateFilePath, this.genesisState.serialize());
    await this.externalSigner.start();

    await Promise.all(this.jobs.map((j) => j.start()));

    // Load half of the validators into the external signer
    for (const node of this.nodes) {
      const halfKeys = node.cl.secretKeys.slice(0, node.cl.secretKeys.length * this.externalKeysPercentage);
      this.externalSigner.addKeys(halfKeys);
      await node.cl.keyManager.importRemoteKeys(
        halfKeys.map((sk) => ({pubkey: sk.toPublicKey().toHex(), url: this.externalSigner.url}))
      );
    }

    await this.tracker.start();
  }

  async stop(): Promise<void> {
    this.options.controller.abort();
    await this.tracker.stop();
    await this.externalSigner.stop();
    await Promise.all(this.jobs.map((j) => j.stop()));
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

  createClientPair({
    el,
    cl,
    keysCount,
    id,
  }: NodePairOptions): {cl: {node: CLNode; job: Job}; el: {node: ELNode; job: Job}} {
    if (this.genesisState && keysCount > 0) {
      throw new Error("Genesis state already initialized. Can not add more keys to it.");
    }

    const keys = Array.from({length: keysCount}, (_, vi) => {
      return interopSecretKey(this.keysCount + vi);
    });
    this.keysCount += keysCount;

    return {cl: this.createCLClient(cl, {id, secretKeys: keys}), el: this.createELClient(el, {id})};
  }

  private createCLClient(
    client: CLClient,
    options?: AtLeast<CLClientOptions, "secretKeys" | "id">
  ): {job: Job; node: CLNode} {
    const nodeIndex = this.nodes.length;
    const clId = `${options?.id}-cl-${client}`;

    switch (client) {
      case CLClient.Lodestar: {
        const genesisStateFilePath = join(this.options.rootDir, "genesis.ssz");
        const opts: CLClientOptions = {
          id: clId,
          rootDir: join(this.options.rootDir, clId),
          logFilePath: join(this.options.logsDir, `${clId}.log`),
          genesisStateFilePath,
          restPort: BN_REST_BASE_PORT + nodeIndex + 1,
          port: BN_P2P_BASE_PORT + nodeIndex + 1,
          keyManagerPort: KEY_MANAGER_BASE_PORT + nodeIndex + 1,
          config: this.forkConfig,
          address: "127.0.0.1",
          secretKeys: options?.secretKeys ?? [],
          genesisTime: this.options.genesisTime,
          externalKeysPercentage: this.externalKeysPercentage,
        };
        return generateLodestarBeaconNode(opts, this.runner);
      }
      default:
        throw new Error(`CL Client "${client}" not supported`);
    }
  }

  private createELClient(client: ELClient, options: AtLeast<ELClientOptions, "id">): {job: Job; node: ELNode} {
    const nodeIndex = this.nodes.length;
    const elId = `${options.id}-el-${client}`;

    switch (client) {
      case ELClient.Geth: {
        const opts: ELClientOptions = {
          id: elId,
          mode: options?.mode ?? ELStartMode.PostMerge,
          ttd: options?.ttd ?? BigInt(0),
          logFilePath: options?.logFilePath ?? join(this.options.logsDir, `${elId}.log`),
          dataDir: options?.dataDir ?? join(this.options.rootDir, elId),
          jwtSecretHex: options?.jwtSecretHex ?? "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d",
          enginePort: options?.enginePort ?? EL_ENGINE_BASE_PORT + nodeIndex + 1,
          ethPort: options?.ethPort ?? EL_ETH_BASE_PORT + nodeIndex + 1,
        };
        return generateGethNode(opts, this.runner);
      }
      default:
        throw new Error(`EL Client "${client}" not supported`);
    }
  }
}

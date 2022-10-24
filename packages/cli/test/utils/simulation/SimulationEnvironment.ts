import {EventEmitter} from "node:events";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import tmp from "tmp";
import {getClient, routes} from "@lodestar/api/beacon";
import {getClient as keyManagerGetClient} from "@lodestar/api/keymanager";
import {createIChainForkConfig, IChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {activePreset, MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {BeaconStateAllForks, interopSecretKey} from "@lodestar/state-transition";
import {nodeUtils} from "@lodestar/beacon-node";
import {EpochClock} from "./EpochClock.js";
import {generateLodeStarBeaconNode} from "./cl_clients/lodestar.js";
import {ChildProcessRunner} from "./runner/child_process.js";
import {SimulationTracker} from "./SimulationTracker.js";
import {
  CLParticipant,
  CLClientOptions,
  Runner,
  SimulationOptionalParams,
  SimulationParams,
  SimulationRequiredParams,
  Job,
  CLClient,
} from "./interfaces.js";
import {
  BN_P2P_BASE_PORT,
  BN_REST_BASE_PORT,
  defaultSimulationParams,
  getSimulationId,
  KEY_MANAGER_BASE_PORT,
  logFilesDir,
} from "./utils.js";
import {ExternalSignerServer} from "./ExternalSignerServer.js";

/* eslint-disable no-console */

export class SimulationEnvironment {
  readonly params: SimulationParams;
  readonly id: string;
  readonly rootDir: string;
  readonly nodes: CLParticipant[] = [];
  readonly clock: EpochClock;
  readonly expectedMinParticipationRate = 0.9;
  readonly expectedMaxInclusionDelay = 2;
  readonly expectedMinAttestationCount = MAX_COMMITTEES_PER_SLOT - 1;
  readonly expectedMinSyncParticipationRate = 0.9;
  readonly tracker: SimulationTracker;
  readonly emitter: EventEmitter;
  readonly controller: AbortController;
  readonly config: IChainForkConfig;
  readonly runner: Runner;
  readonly externalSigner: ExternalSignerServer;

  private readonly genesisState: BeaconStateAllForks;
  private readonly jobs: Job[] = [];

  readonly network = {
    connectAllNodes: async (): Promise<void> => {
      for (let i = 0; i < this.params.beaconNodes; i += 1) {
        for (let j = 0; j < this.params.beaconNodes; j += 1) {
          const networkIdentity = (await this.nodes[j].api.node.getNetworkIdentity()).data;

          if (i === j || !networkIdentity.peerId) continue;

          await this.nodes[i].api.lodestar.connectPeer(networkIdentity.peerId, networkIdentity.p2pAddresses);
        }
      }
    },

    connectNewNode: async (newNode: CLParticipant): Promise<void> => {
      for (const node of this.nodes) {
        const networkIdentity = (await node.api.node.getNetworkIdentity()).data;
        await newNode.api.lodestar.connectPeer(networkIdentity.peerId, networkIdentity.p2pAddresses);
      }
    },
  };

  constructor(params: SimulationRequiredParams & Partial<SimulationOptionalParams>) {
    const paramsWithDefaults = {...defaultSimulationParams, ...params} as SimulationRequiredParams &
      SimulationOptionalParams;

    const genesisTime =
      Math.floor(Date.now() / 1000) + paramsWithDefaults.genesisSlotsDelay * paramsWithDefaults.secondsPerSlot;

    this.params = {
      ...paramsWithDefaults,
      genesisTime,
      slotsPerEpoch: activePreset.SLOTS_PER_EPOCH,
    } as SimulationParams;

    this.config = createIChainForkConfig({
      ...chainConfig,
      /* eslint-disable @typescript-eslint/naming-convention */
      ...{
        SECONDS_PER_SLOT: this.params.secondsPerSlot,
        SLOTS_PER_EPOCH: this.params.slotsPerEpoch,
        GENESIS_DELAY: this.params.genesisSlotsDelay,
        ALTAIR_FORK_EPOCH: this.params.altairEpoch,
        BELLATRIX_FORK_EPOCH: this.params.bellatrixEpoch,
      },
    });
    this.genesisState = nodeUtils.initDevState(
      this.config,
      this.params.beaconNodes * this.params.validatorClients * this.params.validatorsPerClient,
      {
        genesisTime: genesisTime,
      }
    ).state;
    this.controller = new AbortController();
    this.id = getSimulationId(this.params);
    this.rootDir = join(tmp.dirSync({unsafeCleanup: true}).name, this.id);
    this.clock = new EpochClock({
      genesisTime,
      secondsPerSlot: this.params.secondsPerSlot,
      slotsPerEpoch: this.params.slotsPerEpoch,
      signal: this.controller.signal,
    });
    this.emitter = new EventEmitter();
    this.runner = new ChildProcessRunner();
    this.externalSigner = new ExternalSignerServer([]);

    for (let nodeIndex = 0; nodeIndex < this.params.beaconNodes; nodeIndex++) {
      const {participant, job} = this.createCLClient(CLClient.Lodestar, nodeIndex);
      this.jobs.push(job);
      this.nodes.push(participant);
    }

    this.tracker = new SimulationTracker(this.nodes, this.clock, this.params, this.controller.signal);
  }

  async start(): Promise<this> {
    await mkdir(this.rootDir);
    const genesisStateFilePath = join(this.rootDir, "genesis.ssz");
    await writeFile(genesisStateFilePath, this.genesisState.serialize());
    await this.externalSigner.start();

    await Promise.all(this.jobs.map((j) => j.start()));

    // Load half of the validators into the external signer
    for (const node of this.nodes) {
      const halfKeys = node.secretKeys.slice(0, node.secretKeys.length * this.params.externalKeysPercentage);
      this.externalSigner.addKeys(halfKeys);
      await node.keyManager.importRemoteKeys(
        halfKeys.map((sk) => ({pubkey: sk.toPublicKey().toHex(), url: this.externalSigner.url}))
      );
    }

    await this.tracker.start();
    return this;
  }

  async stop(): Promise<void> {
    this.controller.abort();
    await this.tracker.stop();
    await this.externalSigner.stop();
    await Promise.all(this.jobs.map((j) => j.stop()));
    await rm(this.rootDir, {recursive: true});
  }

  // TODO: Add timeout support
  waitForEvent(event: routes.events.EventType, node?: CLParticipant): Promise<routes.events.BeaconEvent> {
    console.log(`Waiting for event "${event}" on "${node?.id ?? "any node"}"`);

    return new Promise((resolve) => {
      const handler = (beaconEvent: routes.events.BeaconEvent, eventNode: CLParticipant): void => {
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

  async waitForSlot(slot: Slot, nodes?: CLParticipant[]): Promise<void> {
    console.log(`\nWaiting for slot on "${nodes ? nodes.map((n) => n.id).join(",") : "all nodes"}"`, {
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

  createCLClient(
    client: CLClient,
    index?: number,
    opts?: Partial<CLClientOptions>
  ): {job: Job; participant: CLParticipant; options: CLClientOptions} {
    const nodeIndex = index ?? this.nodes.length;
    const genesisStateFilePath = join(this.rootDir, "genesis.ssz");
    let options!: CLClientOptions;
    let job!: Job;

    if (client !== CLClient.Lodestar) {
      throw new Error(`Client ${client} not supported`);
    }

    if (client === CLClient.Lodestar) {
      const id = opts?.id ?? `lodestar-bn-${nodeIndex}`;

      options = {
        params: this.params,
        id,
        rootDir: `${this.rootDir}/${id}`,
        logFilePath: `${logFilesDir}/${this.id}/${id}.log`,
        genesisStateFilePath,
        restPort: BN_REST_BASE_PORT + nodeIndex + 1,
        port: BN_P2P_BASE_PORT + nodeIndex + 1,
        keyManagerPort: KEY_MANAGER_BASE_PORT + nodeIndex + 1,
        config: this.config,
        address: "127.0.0.1",
        secretKeys:
          opts?.secretKeys ??
          Array.from({length: this.params.validatorsPerClient}, (_, vi) => {
            return interopSecretKey(nodeIndex * this.params.validatorsPerClient + vi);
          }),
      };
      job = generateLodeStarBeaconNode(options, this.runner);
    }

    const participant: CLParticipant = {
      id: options.id,
      url: `http://${options.address}:${options.restPort}`,
      secretKeys: options.secretKeys,
      // TODO: Switch the CL client here
      api: getClient({baseUrl: `http://${options.address}:${options.restPort}`}, {config: this.config}),
      keyManager: keyManagerGetClient(
        {baseUrl: `http://${options.address}:${options.keyManagerPort}`},
        {config: this.config}
      ),
    };

    return {participant, options, job};
  }
}

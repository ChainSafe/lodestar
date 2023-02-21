import {routes} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/interface.js";
import {ChainEvent} from "../../chain/emitter.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {GossipType} from "../gossip/interface.js";
import {GossipsubAttestationQueue, PendingGossipsubMessage} from "./gossipAttestationQueue.js";
import {NetworkWorker, NetworkWorkerModules} from "./worker.js";

export type NetworkProcessorModules = NetworkWorkerModules & {
  chain: IBeaconChain;
  events: NetworkEventBus;
  logger: Logger;
};

/**
 * Network processor handles the gossip queues and throtles processing to not overload the main thread
 * - Decides when to process work and what to process
 *
 * What triggers execute work?
 *
 * - When work is submitted
 * - When downstream workers become available
 *
 * ### PendingGossipsubMessage beacon_attestation example
 *
 * For attestations, processing the message includes the steps:
 * 1. Pre shuffling sync validation
 * 2. Retrieve shuffling: async + goes into the regen queue and can be expensive
 * 3. Pre sig validation sync validation
 * 4. Validate BLS signature: async + goes into workers through another manager
 *
 * The gossip queues should receive "backpressue" from the regen and BLS workers queues.
 * Such that enough work is processed to fill either one of the queue.
 */
export class NetworkProcessor {
  private readonly gossipsubAttestationQueue: GossipsubAttestationQueue;
  private readonly worker: NetworkWorker;
  private readonly logger: Logger;

  constructor(modules: NetworkProcessorModules) {
    const {chain, events, logger} = modules;
    this.logger = logger;
    this.worker = new NetworkWorker(modules);

    this.gossipsubAttestationQueue = new GossipsubAttestationQueue(chain.forkChoice, chain.clock.currentSlot);

    events.on(NetworkEvent.pendingGossipsubMessage, this.onPendingGossipsubMessage.bind(this));

    chain.emitter.on(routes.events.EventType.block, this.onImportedBlock.bind(this));
    chain.emitter.on(ChainEvent.clockSlot, this.onClockSlot.bind(this));

    // TODO: Pull new work when available
    // this.bls.onAvailable(() => this.executeWork());
    // this.regen.onAvailable(() => this.executeWork());
  }

  private onImportedBlock(data: routes.events.EventData[routes.events.EventType.block]): void {
    this.gossipsubAttestationQueue.onImportedBlock(data.block);
  }

  private onClockSlot(slot: Slot): void {
    this.gossipsubAttestationQueue.onSlot(slot);
  }

  private onPendingGossipsubMessage(data: PendingGossipsubMessage): void {
    switch (data.topic.type) {
      case GossipType.beacon_attestation:
        this.gossipsubAttestationQueue.onAttestation(data);
        break;
    }

    // Tentatively perform work
    this.executeWork();
  }

  private isBlsAvailable(): boolean {
    // TODO: Check if the BLS workers can take more work
    return true;
  }

  private isRegenAvailable(): boolean {
    // TODO: Check if the regen queue is not too busy
    return true;
  }

  private executeWork(): void {
    // TODO: Maybe de-bounce by timing the last time executeWork was run

    if (!this.isBlsAvailable() || !this.isRegenAvailable()) {
      return;
    }

    const work = this.gossipsubAttestationQueue.getWork();
    if (work) {
      this.worker.processGossipAttestations(work).catch((e) => {
        this.logger.error("processGossipAttestations must not throw", {}, e);
      });
    }
  }
}

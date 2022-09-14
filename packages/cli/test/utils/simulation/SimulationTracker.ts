import EventEmitter from "node:events";
import {routes} from "@lodestar/api/beacon";
import {altair, Epoch, Slot} from "@lodestar/types";
import {EpochClock} from "./EpochClock.js";
import {BeaconNodeProcess} from "./types.js";
import {computeAttestation, computeAttestationParticipation, computeInclusionDelay} from "./utils.js";

export class SimulationTracker {
  readonly producedBlocks: Map<string, Map<Slot, boolean>>;
  readonly attestationsPerBlock: Map<string, Map<Slot, number>>;
  readonly inclusionDelayPerBlock: Map<string, Map<Slot, number>>;
  readonly attestationParticipation: Map<string, Map<Epoch, {head: number; source: number; target: number}>>;
  private lastSeenSlot: Map<string, Slot>;

  readonly emitter = new EventEmitter();

  private signal: AbortSignal;
  private nodes: BeaconNodeProcess[];
  private clock: EpochClock;

  constructor(nodes: BeaconNodeProcess[], clock: EpochClock, signal: AbortSignal) {
    this.signal = signal;
    this.nodes = nodes;
    this.clock = clock;

    this.producedBlocks = new Map();
    this.attestationsPerBlock = new Map();
    this.inclusionDelayPerBlock = new Map();
    this.attestationParticipation = new Map();
    this.lastSeenSlot = new Map();

    for (let i = 0; i < nodes.length; i += 1) {
      this.producedBlocks.set(nodes[i].id, new Map());
      this.attestationsPerBlock.set(nodes[i].id, new Map());
      this.inclusionDelayPerBlock.set(nodes[i].id, new Map());
      this.attestationParticipation.set(nodes[i].id, new Map());
      this.lastSeenSlot.set(nodes[i].id, 0);
    }
  }

  get missedBlocks(): Map<string, Slot[]> {
    const missedBlocks: Map<string, Slot[]> = new Map();
    const minSlot = Math.min(...this.lastSeenSlot.values());

    for (let i = 0; i < this.nodes.length; i++) {
      const missedBlocksForNode: Slot[] = [];

      for (let s = 0; s < minSlot; s++) {
        if (!this.producedBlocks.get(this.nodes[i].id)?.get(s)) {
          missedBlocksForNode.push(s);
        }
      }

      missedBlocks.set(this.nodes[i].id, missedBlocksForNode);
    }

    return missedBlocks;
  }

  async start(): Promise<void> {
    for (let i = 0; i < this.nodes.length; i += 1) {
      this.nodes[i].api.events.eventstream(
        [routes.events.EventType.block, routes.events.EventType.head, routes.events.EventType.finalizedCheckpoint],
        this.signal,
        async (event) => {
          this.emitter.emit(event.type, event, this.nodes[i]);

          switch (event.type) {
            case routes.events.EventType.block:
              await this.onBlock(event.message, this.nodes[i]);
              return;
            case routes.events.EventType.finalizedCheckpoint:
              this.onFinalizedCheckpoint(event.message, this.nodes[i]);
              return;
          }
        }
      );
    }
  }

  async stop(): Promise<void> {
    // Do nothing;
  }

  private async onBlock(
    event: routes.events.EventData[routes.events.EventType.block],
    node: BeaconNodeProcess
  ): Promise<void> {
    const slot = event.slot;
    const lastSeenSlot = this.lastSeenSlot.get(node.id);
    const blockAttestations = await node.api.beacon.getBlockAttestations(slot);

    if (lastSeenSlot !== undefined && slot > lastSeenSlot) {
      this.lastSeenSlot.set(node.id, slot);
    }

    this.producedBlocks.get(node.id)?.set(slot, true);
    this.attestationsPerBlock.get(node.id)?.set(slot, computeAttestation(blockAttestations.data));
    this.inclusionDelayPerBlock.get(node.id)?.set(slot, computeInclusionDelay(blockAttestations.data, slot));

    if (this.clock.isFirstSlotOfEpoch(slot)) {
      const state = await node.api.debug.getStateV2("head");
      const participation = computeAttestationParticipation(state.data as altair.BeaconState);

      this.attestationParticipation
        .get(node.id)
        // As the `computeAttestationParticipation` using previousEpochParticipation for calculations
        ?.set(participation.epoch, {
          head: participation.head,
          source: participation.source,
          target: participation.target,
        });
    }
  }

  private onHead(_event: routes.events.EventData[routes.events.EventType.head], _node: BeaconNodeProcess): void {
    // TODO: Add head tracking
  }

  private onFinalizedCheckpoint(
    _event: routes.events.EventData[routes.events.EventType.finalizedCheckpoint],
    _node: BeaconNodeProcess
  ): void {
    // TODO: Add checkpoint tracking
  }

  printLastSeenSlots(): void {
    console.log("==== LAST SEEN SLOTS ====");
    console.table(
      [...this.lastSeenSlot.entries()].map(([node, slot]) => ({node, slot, epoch: this.clock.getEpochForSlot(slot)}))
    );
  }

  printMissedBlocks(): void {
    console.log("==== MISSED BLOCKS ====");
    console.table([...this.missedBlocks.entries()].map(([node, missedBlocks]) => ({node, missedBlocks})));
  }

  printAttestationsParticipation(): void {
    for (let i = 0; i < this.nodes.length; i++) {
      console.log(`==== ATTESTATION PARTICIPATION - ${this.nodes[i].id} ====`);
      console.table(
        [...(this.attestationParticipation.get(this.nodes[i].id)?.entries() || [])].map(([epoch, participation]) => ({
          epoch,
          head: participation.head,
          source: participation.source,
          target: participation.target,
        }))
      );
    }
  }
}

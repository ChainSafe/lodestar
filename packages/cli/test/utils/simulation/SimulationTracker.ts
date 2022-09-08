import {routes} from "@lodestar/api/beacon";
import {altair, Epoch, Slot} from "@lodestar/types";
import {EpochClock} from "./EpochClock.js";
import {BeaconNodeProcess} from "./types.js";
import {computeAttestation, computeAttestationParticipation, computeInclusionDelay} from "./utils.js";

export class SimulationTracker {
  readonly producedBlocks: Map<string, Map<Slot, boolean>>;
  readonly attestationsPerBlock: Map<string, Map<Slot, number>>;
  readonly inclusionDelayPerBlock: Map<string, Map<Slot, number>>;
  readonly participationOnHead: Map<string, Map<Epoch, number>>;
  readonly participationOnFFG: Map<string, Map<Epoch, number>>;

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
    this.participationOnHead = new Map();
    this.participationOnFFG = new Map();

    for (let i = 0; i < nodes.length; i += 1) {
      this.producedBlocks.set(nodes[i].id, new Map());
      this.attestationsPerBlock.set(nodes[i].id, new Map());
      this.inclusionDelayPerBlock.set(nodes[i].id, new Map());
      this.participationOnHead.set(nodes[i].id, new Map());
      this.participationOnFFG.set(nodes[i].id, new Map());
    }
  }

  async start(): Promise<void> {
    for (let i = 0; i < this.nodes.length; i += 1) {
      this.nodes[i].api.events.eventstream(
        [routes.events.EventType.block, routes.events.EventType.head, routes.events.EventType.finalizedCheckpoint],
        this.signal,
        async (event) => {
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
    const blockAttestations = await node.api.beacon.getBlockAttestations(slot);

    this.producedBlocks.get(node.id)?.set(slot, true);
    this.attestationsPerBlock.get(node.id)?.set(slot, computeAttestation(blockAttestations.data));
    this.inclusionDelayPerBlock.get(node.id)?.set(slot, computeInclusionDelay(blockAttestations.data, slot));

    if (this.clock.isFirstSlotOfEpoch(slot)) {
      const epoch = this.clock.getEpochForSlot(slot - 1);
      const state = await node.api.debug.getStateV2("head");

      this.participationOnHead
        .get(node.id)
        ?.set(epoch, computeAttestationParticipation(state.data as altair.BeaconState, "HEAD"));

      this.participationOnFFG
        .get(node.id)
        ?.set(epoch, computeAttestationParticipation(state.data as altair.BeaconState, "FFG"));
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
}

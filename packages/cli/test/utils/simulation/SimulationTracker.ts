import EventEmitter from "node:events";
import {routes} from "@lodestar/api/beacon";
import {IChainForkConfig} from "@lodestar/config";
import {Epoch, Slot} from "@lodestar/types";
import {EpochClock} from "./EpochClock.js";
import {NodeId, NodePair, SimulationAssertion} from "./interfaces.js";
import {getForkName} from "./utils/index.js";

/* eslint-disable no-console */
export class SimulationTracker {
  readonly emitter = new EventEmitter();

  private lastSeenSlot: Map<string, Slot> = new Map();
  private signal: AbortSignal;
  private nodes: NodePair[];
  private clock: EpochClock;
  private config: IChainForkConfig;

  private errors: Record<Slot, string[]> = {};
  private stores: Record<string, Record<NodeId, Record<Slot, unknown>>> = {};
  private assertions: SimulationAssertion<string, unknown>[] = [];
  private assertionsMap: Record<string, number> = {};

  constructor(nodes: NodePair[], config: IChainForkConfig, clock: EpochClock, signal: AbortSignal) {
    this.signal = signal;
    this.nodes = nodes;
    this.clock = clock;
    this.config = config;
  }

  track(node: NodePair): void {
    this.initDataForNode(node);
    this.initEventStreamForNode(node);
    this.nodes.push(node);
  }

  async start(): Promise<void> {
    for (const node of this.nodes) {
      this.initEventStreamForNode(node);
    }
  }

  async stop(): Promise<void> {
    // Do nothing;
  }

  onSlot(slot: Slot, node: NodePair, cb: (slot: Slot) => void): void {
    this.emitter.once(`${node.cl.id}:slot:${slot}`, cb);
  }

  private async onBlock(event: routes.events.EventData[routes.events.EventType.block], node: NodePair): Promise<void> {
    const slot = event.slot;
    const epoch = this.clock.getEpochForSlot(slot);
    const lastSeenSlot = this.lastSeenSlot.get(node.cl.id);

    if (lastSeenSlot !== undefined && slot > lastSeenSlot) {
      this.lastSeenSlot.set(node.cl.id, slot);
    } else {
      // We don't need to process old blocks
      return;
    }

    const block = await node.cl.api.beacon.getBlockV2(slot);

    for (const assertion of this.assertions) {
      if (assertion.capture) {
        const value = await assertion.capture({
          fork: getForkName(epoch, this.config),
          slot,
          block: block.data,
          clock: this.clock,
          node,
          forkConfig: this.config,
          epoch,
          store: this.stores[assertion.key][node.cl.id],
          // TODO: Make the store safe, to filter just the dependant stores not all
          dependantStores: this.stores,
        });
        if (value) {
          this.stores[assertion.key][node.cl.id][slot] = value;
        }
      }
    }

    for (const assertion of this.assertions) {
      this.errors[slot] = this.errors[slot] ?? [];

      if (assertion.match({slot, epoch, clock: this.clock, forkConfig: this.config})) {
        try {
          const errors = await assertion.assert({
            slot,
            epoch,
            nodes: this.nodes,
            clock: this.clock,
            forkConfig: this.config,
            store: this.stores[assertion.key],
            // TODO: Make the store safe, to filter just the dependant stores not all
            dependantStores: this.stores,
          });
          if (errors) {
            this.errors[slot].push(...errors);
          }
        } catch (err: unknown) {
          this.errors[slot].push((err as Error).message);
        }
      }
    }
    this.emitter.emit(`${node.cl.id}:slot:${slot}`, slot);
  }

  private onHead(_event: routes.events.EventData[routes.events.EventType.head], _node: NodePair): void {
    // TODO: Add head tracking
  }

  private onFinalizedCheckpoint(
    _event: routes.events.EventData[routes.events.EventType.finalizedCheckpoint],
    _node: NodePair
  ): void {
    // TODO: Add checkpoint tracking
  }

  register(assertion: SimulationAssertion<string, any>): void {
    if (assertion.key in this.assertionsMap) {
      throw new Error(`The assertion "${assertion.key}" is already registered`);
    }

    for (const dep of assertion.dependencies ?? []) {
      if (dep.key in this.assertionsMap) continue;

      throw new Error(`The assertion "${assertion.key}" depends on "${dep.key}" which is not registered`);
    }

    const index = this.assertions.push(assertion) - 1;
    this.assertionsMap[assertion.key] = index;

    this.stores[assertion.key] = {};
    for (const node of this.nodes) {
      this.stores[assertion.key][node.cl.id] = {};
    }
  }

  initDataForNode(node: NodePair): void {
    this.lastSeenSlot.set(node.cl.id, 0);
    for (const assertion of this.assertions) {
      this.stores[assertion.key][node.cl.id] = {};
    }
  }

  printNodesInfo(epoch?: Epoch): void {
    /* eslint-disable @typescript-eslint/naming-convention */
    const minSlot = epoch != null ? this.clock.getFirstSlotOfEpoch(epoch) : 0;
    const maxSlot = epoch != null ? this.clock.getLastSlotOfEpoch(epoch) : Math.max(...this.lastSeenSlot.values());
    const records: Record<string, unknown>[] = [];

    for (let slot = minSlot; slot <= maxSlot; slot++) {
      const epoch = this.clock.getEpochForSlot(slot);
      const forkName = getForkName(epoch, this.config);
      const epochStr = `${this.clock.getEpochForSlot(slot)}/${this.clock.getSlotIndexInEpoch(slot)}`;

      const finalizedSlots = this.nodes.map(
        (node) => this.slotMeasures.get(node.cl.id)?.get(slot)?.finalizedSlot ?? "-"
      );
      const finalizedSlotsUnique = new Set(finalizedSlots);
      const attestationCount = this.nodes.map(
        (node) => this.slotMeasures.get(node.cl.id)?.get(slot)?.attestationsCount ?? "-"
      );
      const attestationCountUnique = new Set(attestationCount);
      const inclusionDelay = this.nodes.map(
        (node) => this.slotMeasures.get(node.cl.id)?.get(slot)?.inclusionDelay ?? "-"
      );
      const inclusionDelayUnique = new Set(inclusionDelay);
      const attestationParticipation = this.nodes.map(
        (node) => this.slotMeasures.get(node.cl.id)?.get(slot)?.syncCommitteeParticipation ?? "-"
      );
      const attestationParticipationUnique = new Set(attestationParticipation);

      const record: Record<string, unknown> = {
        F: forkName,
        Eph: epochStr,
        slot,
        "Missed Slots": this.nodes.map((node) => (this.slotMeasures.get(node.cl.id)?.has(slot) ? "-" : "x")).join(""),
        "Finalized Slots": finalizedSlotsUnique.size === 1 ? finalizedSlots[0] : finalizedSlots.join(","),
        "Attestations Count": attestationCountUnique.size === 1 ? attestationCount[0] : attestationCount.join(","),
        "Inclusion Delay": inclusionDelayUnique.size === 1 ? inclusionDelay[0] : inclusionDelay.join(","),
        "SC Participation":
          attestationParticipationUnique.size === 1 ? attestationParticipation[0] : attestationParticipation.join(","),
        Peer: this.nodes
          .map((node) => this.slotMeasures.get(node.cl.id)?.get(slot)?.connectedPeerCount ?? "-")
          .join(","),
      };

      // TODO: Find a better way to show the heads on each slot
      // for (const node of this.nodes) {
      //   record[nodeHeadHeading(node.cl.id)] = this.headPerSlot.get(node.cl.id)?.get(slot) ?? "";
      // }

      records.push(record);

      if (this.clock.isLastSlotOfEpoch(slot)) {
        const participation = this.nodes.map((node) => {
          const participation = this.epochMeasures.get(node.cl.id)?.get(epoch)?.attestationParticipationAvg;
          if (!participation) return "-";
          return `${participation.head.toFixed(2)},${participation.source.toFixed(2)},${participation.target.toFixed(
            2
          )}`;
        });
        const participationUnique = new Set(participation);

        const summary: Record<string, unknown> = {
          F: forkName,
          Eph: epoch,
          slot: "---",
          "Missed Slots": this.nodes
            .map((node) => this.epochMeasures.get(node.cl.id)?.get(epoch)?.missedSlots.length)
            .join(","),
          "Finalized Slots": Array(this.nodes.length).fill("-").join(""),
          "Attestations Count": participationUnique.size === 1 ? participation[0] : participation.join(","),
          "Inclusion Delay": Array(this.nodes.length).fill("-").join(""),
          "SC Participation": this.nodes
            .map((node) => this.epochMeasures.get(node.cl.id)?.get(epoch)?.syncCommitteeParticipationAvg ?? "-")
            .join(","),
          Peer: Array(this.nodes.length).fill("-").join(""),
        };
        records.push(summary);
      }
    }

    console.table(records);
    /* eslint-enable @typescript-eslint/naming-convention */
  }

  private initEventStreamForNode(node: NodePair): void {
    node.cl.api.events.eventstream(
      [routes.events.EventType.block, routes.events.EventType.head, routes.events.EventType.finalizedCheckpoint],
      this.signal,
      async (event) => {
        this.emitter.emit(event.type, event, node);

        switch (event.type) {
          case routes.events.EventType.block:
            await this.onBlock(event.message, node);
            return;
          case routes.events.EventType.finalizedCheckpoint:
            this.onFinalizedCheckpoint(event.message, node);
            return;
        }
      }
    );
  }
}

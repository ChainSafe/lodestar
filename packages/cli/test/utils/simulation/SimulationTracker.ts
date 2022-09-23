import EventEmitter from "node:events";
import {routes} from "@lodestar/api/beacon";
import {TIMELY_HEAD_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX, ForkName} from "@lodestar/params";
import {allForks, altair, Epoch, Slot} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {EpochClock} from "./EpochClock.js";
import {BeaconNodeProcess, SimulationParams} from "./types.js";
import {avg, getForkName} from "./utils.js";

const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;

type SlotMeasureInput = {
  version: ForkName;
  slot: Slot;
  node: BeaconNodeProcess;
  block: allForks.SignedBeaconBlock;
  clock: EpochClock;
};

type EpochMeasureInput = SlotMeasureInput & {
  epoch: Epoch;
  startSlot: Slot;
  endSlot: Slot;
  slotsMeasures: Map<Slot, SlotMeasure>;
  state: allForks.BeaconState;
};

export type CommonMeasure = {
  readonly fork: ForkName;
  readonly epochStr: string;
  readonly epoch: Epoch;
  readonly slot: Slot;
};

export type SlotMeasure = CommonMeasure & {
  readonly attestationsCount: number;
  readonly inclusionDelay: number;
  readonly head: string;
  readonly finalizedSlot: Slot;
  readonly syncCommitteeParticipation: number;
};

export type EpochMeasure = CommonMeasure & {
  readonly missedSlots: number[];
  readonly attestationParticipationAvg: {head: number; source: number; target: number};
  readonly syncCommitteeParticipationAvg: number;
};

export const processAttestationsCount = async ({slot, node}: SlotMeasureInput): Promise<number> => {
  const attestations = await node.api.beacon.getBlockAttestations(slot);

  return Array.from(attestations.data).reduce(
    (total, att) => total + att.aggregationBits.getTrueBitIndexes().length,
    0
  );
};

export const processInclusionDelay = async ({slot, node}: SlotMeasureInput): Promise<number> => {
  const attestations = await node.api.beacon.getBlockAttestations(slot);

  return avg(Array.from(attestations.data).map((att) => slot - att.data.slot));
};

export const processHead = async ({node}: SlotMeasureInput): Promise<string> => {
  const head = await node.api.beacon.getBlockHeader("head");

  return toHexString(head.data.root);
};

export const processFinalized = async ({node}: SlotMeasureInput): Promise<number> => {
  const finalized = await node.api.beacon.getBlockHeader("finalized");
  return finalized.data.header.message.slot;
};

export const processSyncCommitteeParticipation = async ({version, block}: SlotMeasureInput): Promise<number> => {
  if (version === ForkName.phase0) {
    return 0;
  }

  const {syncCommitteeBits} = (block as altair.SignedBeaconBlock).message.body.syncAggregate;
  return syncCommitteeBits.getTrueBitIndexes().length / syncCommitteeBits.bitLen;
};

export const processSlotMeasure = async (input: SlotMeasureInput): Promise<SlotMeasure> => {
  const [attestationsCount, inclusionDelay, head, finalized, syncCommitteeParticipation] = await Promise.all([
    processAttestationsCount(input),
    processInclusionDelay(input),
    processHead(input),
    processFinalized(input),
    processSyncCommitteeParticipation(input),
  ]);

  const epoch = input.clock.getEpochForSlot(input.slot);

  return {
    fork: input.version,
    slot: input.slot,
    epoch,
    epochStr: `${epoch}/${input.clock.getSlotIndexInEpoch(input.slot)}`,
    attestationsCount,
    inclusionDelay,
    head,
    finalizedSlot: finalized,
    syncCommitteeParticipation,
  };
};

export const processEpochMissedSlots = async ({
  startSlot,
  endSlot,
  slotsMeasures,
}: EpochMeasureInput): Promise<number[]> => {
  const missedSlots: number[] = [];

  for (let slot = startSlot; slot < endSlot; slot++) {
    if (!slotsMeasures.has(slot)) {
      missedSlots.push(slot);
    }
  }
  return missedSlots;
};

export const processAttestationEpochParticipationAvg = async ({
  version,
  state,
}: EpochMeasureInput): Promise<{head: number; source: number; target: number}> => {
  if (version === ForkName.phase0) {
    return {head: 0, source: 0, target: 0};
  }

  // Attestation to be computed at the end of epoch. At that time the "currentEpochParticipation" is all set to zero
  // and we have to use "previousEpochParticipation" instead.
  const previousEpochParticipation = (state as altair.BeaconState).previousEpochParticipation;
  const totalAttestingBalance = {head: 0, source: 0, target: 0};
  let totalEffectiveBalance = 0;

  for (let i = 0; i < previousEpochParticipation.length; i++) {
    totalAttestingBalance.head +=
      previousEpochParticipation[i] & TIMELY_HEAD ? state.validators[i].effectiveBalance : 0;
    totalAttestingBalance.source +=
      previousEpochParticipation[i] & TIMELY_SOURCE ? state.validators[i].effectiveBalance : 0;
    totalAttestingBalance.target +=
      previousEpochParticipation[i] & TIMELY_TARGET ? state.validators[i].effectiveBalance : 0;

    totalEffectiveBalance += state.validators[i].effectiveBalance;
  }

  totalAttestingBalance.head = totalAttestingBalance.head / totalEffectiveBalance;
  totalAttestingBalance.source = totalAttestingBalance.source / totalEffectiveBalance;
  totalAttestingBalance.target = totalAttestingBalance.target / totalEffectiveBalance;

  return totalAttestingBalance;
};

export const processSyncCommitteeParticipationAvg = async ({
  startSlot,
  endSlot,
  version,
  slotsMeasures: slotsMetrics,
}: EpochMeasureInput): Promise<number> => {
  if (version === ForkName.phase0) {
    return 0;
  }

  const participation: number[] = [];

  for (let slot = startSlot; slot <= endSlot; slot++) {
    participation.push(slotsMetrics.get(slot)?.syncCommitteeParticipation ?? 0);
  }

  return avg(participation);
};

export const processEpochMeasure = async (input: EpochMeasureInput): Promise<EpochMeasure> => {
  const [missedSlots, attestationParticipationAvg, syncCommitteeParticipationAvg] = await Promise.all([
    processEpochMissedSlots(input),
    processAttestationEpochParticipationAvg(input),
    processSyncCommitteeParticipationAvg(input),
  ]);

  return {
    fork: input.version,
    epoch: input.epoch,
    slot: input.slot,
    epochStr: `${input.epoch}/${input.clock.getSlotIndexInEpoch(input.slot)}`,
    missedSlots,
    attestationParticipationAvg,
    syncCommitteeParticipationAvg,
  };
};

export class SimulationTracker {
  readonly slotMeasures: Map<string, Map<Slot, SlotMeasure>> = new Map();
  readonly epochMeasures: Map<string, Map<Epoch, EpochMeasure>> = new Map();
  readonly emitter = new EventEmitter();

  private lastSeenSlot: Map<string, Slot> = new Map();
  private signal: AbortSignal;
  private nodes: BeaconNodeProcess[];
  private clock: EpochClock;
  private params: SimulationParams;

  constructor(nodes: BeaconNodeProcess[], clock: EpochClock, params: SimulationParams, signal: AbortSignal) {
    this.signal = signal;
    this.nodes = nodes;
    this.clock = clock;
    this.params = params;

    for (const node of nodes) {
      this.slotMeasures.set(node.id, new Map());
      this.epochMeasures.set(node.id, new Map());
      this.lastSeenSlot.set(node.id, 0);

      // We don't receive genesis block on event stream
      this.slotMeasures.get(node.id)?.set(0, {
        slot: 0,
        epoch: 0,
        epochStr: "0/0",
        fork: getForkName(0, this.params),
        attestationsCount: 0,
        inclusionDelay: 0,
        finalizedSlot: 0,
        syncCommitteeParticipation: 0,
        head: "",
      });
    }
  }

  async start(): Promise<void> {
    for (const node of this.nodes) {
      node.api.events.eventstream(
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

  async stop(): Promise<void> {
    // Do nothing;
  }

  private async onBlock(
    event: routes.events.EventData[routes.events.EventType.block],
    node: BeaconNodeProcess
  ): Promise<void> {
    const slot = event.slot;
    const lastSeenSlot = this.lastSeenSlot.get(node.id);

    if (lastSeenSlot !== undefined && slot > lastSeenSlot) {
      this.lastSeenSlot.set(node.id, slot);
    }

    const block = await node.api.beacon.getBlockV2(slot);

    this.slotMeasures
      .get(node.id)
      ?.set(slot, await processSlotMeasure({version: block.version, slot, node, block: block.data, clock: this.clock}));

    if (this.clock.isFirstSlotOfEpoch(slot)) {
      // Compute measures for the last epoch
      const epoch = this.clock.getEpochForSlot(slot) - 1;
      const startSlot = this.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = this.clock.getLastSlotOfEpoch(epoch);
      const state = await node.api.debug.getStateV2("head");

      this.epochMeasures.get(node.id)?.set(
        epoch,
        await processEpochMeasure({
          slot,
          startSlot,
          endSlot,
          epoch,
          node,
          block: block.data,
          version: block.version,
          slotsMeasures: this.slotMeasures.get(node.id) ?? new Map<Slot, SlotMeasure>(),
          state: state.data,
          clock: this.clock,
        })
      );
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

  printNoesInfo(): void {
    /* eslint-disable @typescript-eslint/naming-convention */
    const maxSlot = Math.max(...this.lastSeenSlot.values());
    const records: Record<string, unknown>[] = [];

    for (let slot = 0; slot <= maxSlot; slot++) {
      const epoch = this.clock.getEpochForSlot(slot);
      const forkName = getForkName(epoch, this.params);
      const epochStr = `${this.clock.getEpochForSlot(slot)}/${this.clock.getSlotIndexInEpoch(slot)}`;

      const record: Record<string, unknown> = {
        F: forkName,
        Eph: epochStr,
        slot,
        "Missed Slots": this.nodes.map((node) => (this.slotMeasures.get(node.id)?.has(slot) ? "-" : "x")).join(""),
        "Finalized Slots": this.nodes
          .map((node) => this.slotMeasures.get(node.id)?.get(slot)?.finalizedSlot ?? "-")
          .join(" | "),
        "Attestations Count": this.nodes
          .map((node) => this.slotMeasures.get(node.id)?.get(slot)?.attestationsCount ?? "-")
          .join(" | "),
        "Inclusion Delay": this.nodes
          .map((node) => this.slotMeasures.get(node.id)?.get(slot)?.inclusionDelay ?? "-")
          .join(" | "),
        "SC Participation": this.nodes
          .map((node) => this.slotMeasures.get(node.id)?.get(slot)?.syncCommitteeParticipation ?? "-")
          .join(" | "),
      };

      // TODO: Find a better way to show the heads on each slot
      // for (const node of this.nodes) {
      //   record[nodeHeadHeading(node.id)] = this.headPerSlot.get(node.id)?.get(slot) ?? "";
      // }

      records.push(record);

      if (this.clock.isLastSlotOfEpoch(slot)) {
        const summary: Record<string, unknown> = {
          F: forkName,
          Eph: epoch,
          slot: "---",
          "Missed Slots": this.nodes
            .map((node) => this.epochMeasures.get(node.id)?.get(epoch)?.missedSlots.length)
            .join(" | "),
          "Finalized Slots": Array(this.nodes.length).fill("-").join(" | "),
          "Attestations Count": this.nodes
            .map((node) => {
              const participation = this.epochMeasures.get(node.id)?.get(epoch)?.attestationParticipationAvg;
              if (!participation) return "-";

              return `${participation.head.toFixed(2)},${participation.source.toFixed(
                2
              )},${participation.target.toFixed(2)}`;
            })
            .join(" | "),
          "Inclusion Delay": Array(this.nodes.length).fill("-").join(" | "),
          "SC Participation": this.nodes
            .map((node) => this.epochMeasures.get(node.id)?.get(epoch)?.syncCommitteeParticipationAvg ?? "-")
            .join(" | "),
        };
        records.push(summary);
      }
    }

    console.table(records);
    /* eslint-enable @typescript-eslint/naming-convention */
  }
}

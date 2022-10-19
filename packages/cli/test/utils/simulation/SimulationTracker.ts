import EventEmitter from "node:events";
import {routes} from "@lodestar/api/beacon";
import {TIMELY_HEAD_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX, ForkName} from "@lodestar/params";
import {allForks, altair, Epoch, Slot} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {isActiveValidator} from "@lodestar/state-transition";
import {EpochClock} from "./EpochClock.js";
import {CLParticipant, SimulationParams} from "./types.js";
import {avg, getForkName} from "./utils.js";

const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;

type SlotMeasureInput = {
  fork: ForkName;
  slot: Slot;
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

export type CommonSlotMeasure = {
  readonly fork: ForkName;
  readonly epochStr: string;
  readonly epoch: Epoch;
  readonly slot: Slot;
};

export type SlotMeasure = CommonSlotMeasure & {
  readonly attestationsCount: number;
  readonly inclusionDelay: number;
  readonly head: string;
  readonly finalizedSlot: Slot;
  readonly syncCommitteeParticipation: number;
  readonly connectedPeerCount: number;
};

export type EpochMeasure = CommonSlotMeasure & {
  readonly missedSlots: number[];
  readonly attestationParticipationAvg: {head: number; source: number; target: number};
  readonly syncCommitteeParticipationAvg: number;
};

export const processAttestationsCount = async (_node: CLParticipant, {block}: SlotMeasureInput): Promise<number> => {
  // Use a Set since the same validator can be included in multiple attestations
  const shuffledParticipants = new Set<number>();

  for (const attestation of block.message.body.attestations) {
    // Assume constant committee size on all committees
    const committeeSize = attestation.aggregationBits.bitLen;
    const indexesInCommittee = attestation.aggregationBits.getTrueBitIndexes();
    for (const indexInCommittee of indexesInCommittee) {
      const shuffledIndex = indexInCommittee + attestation.data.index * committeeSize;
      shuffledParticipants.add(shuffledIndex);
    }
  }

  return shuffledParticipants.size;
};

export const processInclusionDelay = async (_node: CLParticipant, {block}: SlotMeasureInput): Promise<number> => {
  return avg(Array.from(block.message.body.attestations).map((att) => block.message.slot - att.data.slot));
};

export const processHead = async (node: CLParticipant, _: SlotMeasureInput): Promise<string> => {
  const head = await node.api.beacon.getBlockHeader("head");

  return toHexString(head.data.root);
};

export const processFinalized = async (node: CLParticipant, _: SlotMeasureInput): Promise<number> => {
  const finalized = await node.api.beacon.getBlockHeader("finalized");
  return finalized.data.header.message.slot;
};

export const processSyncCommitteeParticipation = async (
  _node: CLParticipant,
  {fork: version, block}: SlotMeasureInput
): Promise<number> => {
  if (version === ForkName.phase0) {
    return 0;
  }

  const {syncCommitteeBits} = (block as altair.SignedBeaconBlock).message.body.syncAggregate;
  return syncCommitteeBits.getTrueBitIndexes().length / syncCommitteeBits.bitLen;
};

export const processConnectedPeerCount = async (node: CLParticipant): Promise<number> => {
  return (await node.api.node.getPeerCount()).data.connected;
};

export const processSlotMeasure = async (node: CLParticipant, input: SlotMeasureInput): Promise<SlotMeasure> => {
  const [
    attestationsCount,
    inclusionDelay,
    head,
    finalized,
    syncCommitteeParticipation,
    connectedPeerCount,
  ] = await Promise.all([
    processAttestationsCount(node, input),
    processInclusionDelay(node, input),
    processHead(node, input),
    processFinalized(node, input),
    processSyncCommitteeParticipation(node, input),
    processConnectedPeerCount(node),
  ]);

  const epoch = input.clock.getEpochForSlot(input.slot);

  return {
    fork: input.fork,
    slot: input.slot,
    epoch,
    epochStr: `${epoch}/${input.clock.getSlotIndexInEpoch(input.slot)}`,
    attestationsCount,
    inclusionDelay,
    head,
    finalizedSlot: finalized,
    syncCommitteeParticipation,
    connectedPeerCount,
  };
};

export const processEpochMissedSlots = async (
  _node: CLParticipant,
  {startSlot, endSlot, slotsMeasures}: EpochMeasureInput
): Promise<number[]> => {
  const missedSlots: number[] = [];

  for (let slot = startSlot; slot < endSlot; slot++) {
    if (!slotsMeasures.has(slot)) {
      missedSlots.push(slot);
    }
  }
  return missedSlots;
};

export const processAttestationEpochParticipationAvg = async (
  _node: CLParticipant,
  {fork, state, epoch}: EpochMeasureInput
): Promise<{head: number; source: number; target: number}> => {
  if (fork === ForkName.phase0) {
    return {head: 0, source: 0, target: 0};
  }

  // Attestation to be computed at the end of epoch. At that time the "currentEpochParticipation" is all set to zero
  // and we have to use "previousEpochParticipation" instead.
  const previousEpochParticipation = (state as altair.BeaconState).previousEpochParticipation;
  const totalAttestingBalance = {head: 0, source: 0, target: 0};
  let totalEffectiveBalance = 0;

  for (let i = 0; i < previousEpochParticipation.length; i++) {
    const {effectiveBalance} = state.validators[i];

    totalAttestingBalance.head += previousEpochParticipation[i] & TIMELY_HEAD ? effectiveBalance : 0;
    totalAttestingBalance.source += previousEpochParticipation[i] & TIMELY_SOURCE ? effectiveBalance : 0;
    totalAttestingBalance.target += previousEpochParticipation[i] & TIMELY_TARGET ? effectiveBalance : 0;

    if (isActiveValidator(state.validators[i], epoch)) {
      totalEffectiveBalance += effectiveBalance;
    }
  }

  totalAttestingBalance.head = totalAttestingBalance.head / totalEffectiveBalance;
  totalAttestingBalance.source = totalAttestingBalance.source / totalEffectiveBalance;
  totalAttestingBalance.target = totalAttestingBalance.target / totalEffectiveBalance;

  return totalAttestingBalance;
};

export const processSyncCommitteeParticipationAvg = async (
  _node: CLParticipant,
  {startSlot, endSlot, fork: version, slotsMeasures: slotsMetrics}: EpochMeasureInput
): Promise<number> => {
  if (version === ForkName.phase0) {
    return 0;
  }

  const participation: number[] = [];

  for (let slot = startSlot; slot <= endSlot; slot++) {
    participation.push(slotsMetrics.get(slot)?.syncCommitteeParticipation ?? 0);
  }

  return avg(participation);
};

export const processEpochMeasure = async (node: CLParticipant, input: EpochMeasureInput): Promise<EpochMeasure> => {
  const [missedSlots, attestationParticipationAvg, syncCommitteeParticipationAvg] = await Promise.all([
    processEpochMissedSlots(node, input),
    processAttestationEpochParticipationAvg(node, input),
    processSyncCommitteeParticipationAvg(node, input),
  ]);

  return {
    fork: input.fork,
    epoch: input.epoch,
    slot: input.slot,
    epochStr: `${input.epoch}/${input.clock.getSlotIndexInEpoch(input.slot)}`,
    missedSlots,
    attestationParticipationAvg,
    syncCommitteeParticipationAvg,
  };
};

/* eslint-disable no-console */
export class SimulationTracker {
  readonly slotMeasures: Map<string, Map<Slot, SlotMeasure>> = new Map();
  readonly epochMeasures: Map<string, Map<Epoch, EpochMeasure>> = new Map();
  readonly emitter = new EventEmitter();

  private lastSeenSlot: Map<string, Slot> = new Map();
  private signal: AbortSignal;
  private nodes: CLParticipant[];
  private clock: EpochClock;
  private params: SimulationParams;

  constructor(nodes: CLParticipant[], clock: EpochClock, params: SimulationParams, signal: AbortSignal) {
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
        connectedPeerCount: 0,
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

  onSlot(slot: Slot, node: CLParticipant, cb: (slot: Slot) => void): void {
    this.emitter.once(`${node.id}:slot:${slot}`, cb);
  }

  private async onBlock(
    event: routes.events.EventData[routes.events.EventType.block],
    node: CLParticipant
  ): Promise<void> {
    const slot = event.slot;
    const lastSeenSlot = this.lastSeenSlot.get(node.id);

    if (lastSeenSlot !== undefined && slot > lastSeenSlot) {
      this.lastSeenSlot.set(node.id, slot);
    } else {
      // We don't need to process old blocks
      return;
    }

    const block = await node.api.beacon.getBlockV2(slot);

    this.slotMeasures
      .get(node.id)
      ?.set(slot, await processSlotMeasure(node, {fork: block.version, slot, block: block.data, clock: this.clock}));

    if (this.clock.isFirstSlotOfEpoch(slot)) {
      // Compute measures for the last epoch
      const epoch = this.clock.getEpochForSlot(slot) - 1;
      const startSlot = this.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = this.clock.getLastSlotOfEpoch(epoch);
      const state = await node.api.debug.getStateV2("head");

      this.epochMeasures.get(node.id)?.set(
        epoch,
        await processEpochMeasure(node, {
          slot,
          startSlot,
          endSlot,
          epoch,
          block: block.data,
          fork: block.version,
          slotsMeasures: this.slotMeasures.get(node.id) ?? new Map<Slot, SlotMeasure>(),
          state: state.data,
          clock: this.clock,
        })
      );
    }
    this.emitter.emit(`${node.id}:slot:${slot}`, slot);
  }

  private onHead(_event: routes.events.EventData[routes.events.EventType.head], _node: CLParticipant): void {
    // TODO: Add head tracking
  }

  private onFinalizedCheckpoint(
    _event: routes.events.EventData[routes.events.EventType.finalizedCheckpoint],
    _node: CLParticipant
  ): void {
    // TODO: Add checkpoint tracking
  }

  printNoesInfo(epoch?: Epoch): void {
    /* eslint-disable @typescript-eslint/naming-convention */
    const minSlot = epoch != null ? this.clock.getFirstSlotOfEpoch(epoch) : 0;
    const maxSlot = epoch != null ? this.clock.getLastSlotOfEpoch(epoch) : Math.max(...this.lastSeenSlot.values());
    const records: Record<string, unknown>[] = [];

    for (let slot = minSlot; slot <= maxSlot; slot++) {
      const epoch = this.clock.getEpochForSlot(slot);
      const forkName = getForkName(epoch, this.params);
      const epochStr = `${this.clock.getEpochForSlot(slot)}/${this.clock.getSlotIndexInEpoch(slot)}`;

      const finalizedSLots = this.nodes.map((node) => this.slotMeasures.get(node.id)?.get(slot)?.finalizedSlot ?? "-");
      const finalizedSlotsUnique = new Set(finalizedSLots);
      const attestationCount = this.nodes.map(
        (node) => this.slotMeasures.get(node.id)?.get(slot)?.attestationsCount ?? "-"
      );
      const attestationCountUnique = new Set(attestationCount);
      const inclusionDelay = this.nodes.map((node) => this.slotMeasures.get(node.id)?.get(slot)?.inclusionDelay ?? "-");
      const inclusionDelayUnique = new Set(inclusionDelay);
      const attestationParticipation = this.nodes.map(
        (node) => this.slotMeasures.get(node.id)?.get(slot)?.syncCommitteeParticipation ?? "-"
      );
      const attestationParticipationUnique = new Set(attestationParticipation);

      const record: Record<string, unknown> = {
        F: forkName,
        Eph: epochStr,
        slot,
        "Missed Slots": this.nodes.map((node) => (this.slotMeasures.get(node.id)?.has(slot) ? "-" : "x")).join(""),
        "Finalized Slots": finalizedSlotsUnique.size === 1 ? finalizedSLots[0] : finalizedSLots.join(","),
        "Attestations Count": attestationCountUnique.size === 1 ? attestationCount[0] : attestationCount.join(","),
        "Inclusion Delay": inclusionDelayUnique.size === 1 ? inclusionDelay[0] : inclusionDelay.join(","),
        "SC Participation":
          attestationParticipationUnique.size === 1 ? attestationParticipation[0] : attestationParticipation.join(","),
        Peer: this.nodes.map((node) => this.slotMeasures.get(node.id)?.get(slot)?.connectedPeerCount ?? "-").join(","),
      };

      // TODO: Find a better way to show the heads on each slot
      // for (const node of this.nodes) {
      //   record[nodeHeadHeading(node.id)] = this.headPerSlot.get(node.id)?.get(slot) ?? "";
      // }

      records.push(record);

      if (this.clock.isLastSlotOfEpoch(slot)) {
        const participation = this.nodes.map((node) => {
          const participation = this.epochMeasures.get(node.id)?.get(epoch)?.attestationParticipationAvg;
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
            .map((node) => this.epochMeasures.get(node.id)?.get(epoch)?.missedSlots.length)
            .join(","),
          "Finalized Slots": Array(this.nodes.length).fill("-").join(""),
          "Attestations Count": participationUnique.size === 1 ? participation[0] : participation.join(","),
          "Inclusion Delay": Array(this.nodes.length).fill("-").join(""),
          "SC Participation": this.nodes
            .map((node) => this.epochMeasures.get(node.id)?.get(epoch)?.syncCommitteeParticipationAvg ?? "-")
            .join(","),
          Peer: Array(this.nodes.length).fill("-").join(""),
        };
        records.push(summary);
      }
    }

    console.table(records);
    /* eslint-enable @typescript-eslint/naming-convention */
  }
}

import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {IClock, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot, ValidatorIndex, eip8453} from "@lodestar/types";
import {sleep, toRootHex} from "@lodestar/utils";
import {PubkeyHex} from "../types.js";
import {LoggerVc} from "../util/index.js";
import {ValidatorStore} from "./validatorStore.js";

/** `FinalitySigningRecord` of validator.md: a validator's finality gadget signing history, per key */
export type FinalitySigningRecord = {
  /** The first target voted for at each height */
  targets: Map<number, string>;
  /** Heights at which a timeout was signed */
  timeouts: Set<number>;
  /** The block named by a finality vote at each height */
  finalityLocks: Map<number, string>;
  /** Entries named by any height vote at each height */
  entries: Map<number, Set<string>>;
};

export function emptyFinalitySigningRecord(): FinalitySigningRecord {
  return {targets: new Map(), timeouts: new Set(), finalityLocks: new Map(), entries: new Map()};
}

type HeightCheckpoint = eip8453.HeightCheckpoint;
const EMPTY_ROOT_HEX = `0x${"00".repeat(32)}`;
const isEmpty = (c: HeightCheckpoint): boolean => c.height === 0 && toRootHex(c.root) === EMPTY_ROOT_HEX;
const emptyCheckpoint = (): HeightCheckpoint => ({height: 0, root: new Uint8Array(32)});

/** Spec: get_finality_vote */
export function getFinalityVote(
  record: FinalitySigningRecord,
  justified: HeightCheckpoint,
  finalizedHeight: number
): HeightCheckpoint {
  const {height} = justified;
  const root = toRootHex(justified.root);
  if (height <= finalizedHeight) return emptyCheckpoint();
  const target = record.targets.get(height);
  if (target !== undefined && target !== root) return emptyCheckpoint();
  if (record.timeouts.has(height)) return emptyCheckpoint();
  const lock = record.finalityLocks.get(height);
  if (lock !== undefined && lock !== root) return emptyCheckpoint();
  return {height, root: justified.root.slice()};
}

/** Spec: get_height_vote */
export function getHeightVote(
  record: FinalitySigningRecord,
  target: HeightCheckpoint,
  finality: HeightCheckpoint
): {target: HeightCheckpoint; timeout: boolean} | null {
  const {height} = target;
  const root = toRootHex(target.root);
  if (height === 0 || root === EMPTY_ROOT_HEX) return null;
  let lock = record.finalityLocks.get(height);
  if (!isEmpty(finality) && finality.height === height) lock = toRootHex(finality.root);
  const copy = {height, root: target.root.slice()};
  if (record.timeouts.has(height)) return {target: copy, timeout: true};
  if (lock !== undefined) return lock === root ? {target: copy, timeout: false} : null;
  const first = record.targets.get(height);
  if (first === undefined || first === root) return {target: copy, timeout: false};
  return {target: copy, timeout: true};
}

/** Spec: get_finality_attestation_data; null means the validator sends no new attestation */
export function getFinalityAttestationData(
  record: FinalitySigningRecord,
  target: HeightCheckpoint,
  justified: HeightCheckpoint,
  finalizedHeight: number
): eip8453.AttestationData | null {
  let finality = getFinalityVote(record, justified, finalizedHeight);
  const vote = getHeightVote(record, target, finality);
  if (vote === null) return null;
  const entries = record.entries.get(vote.target.height) ?? new Set<string>();
  if ((!vote.timeout && entries.size > 0) || entries.has(toRootHex(vote.target.root))) return null;
  if (!isEmpty(finality) && vote.target.height <= finality.height) finality = emptyCheckpoint();
  return {target: vote.target, timeout: vote.timeout, finality};
}

/** Spec: record_finality_attestation */
export function recordFinalityAttestation(record: FinalitySigningRecord, data: eip8453.AttestationData): void {
  const {height} = data.target;
  const root = toRootHex(data.target.root);
  let entries = record.entries.get(height);
  if (entries === undefined) {
    entries = new Set();
    record.entries.set(height, entries);
  }
  entries.add(root);
  if (!isEmpty(data.finality)) record.finalityLocks.set(data.finality.height, toRootHex(data.finality.root));
  if (data.timeout) record.timeouts.add(height);
  else if (!record.targets.has(height)) record.targets.set(height, root);
}

type HeadVoteDuty = routes.validator.HeadVoteDuty;
type FinalityAttesterDuty = routes.validator.FinalityAttesterDuty;

/**
 * [EIP8453] Head voting and finality gadget attesting. Duties are polled per epoch for the current and next
 * epoch; head votes are cast a quarter into the slot (the Goldilocks `Δ`) and FG attestations half way, after
 * the beacon node's confirmation view. The signing record replaces slashing protection for FG attestations and
 * is kept in memory: a restarted validator client starts with an empty record, which the spec says it must not
 * (persistence is a TODO).
 */
export class DecoupledConsensusService {
  private readonly headVoteDuties = new Map<Epoch, HeadVoteDuty[]>();
  private readonly attesterDuties = new Map<Epoch, FinalityAttesterDuty[]>();
  private readonly records = new Map<PubkeyHex, FinalitySigningRecord>();
  private readonly indexByPubkey = new Map<PubkeyHex, ValidatorIndex>();

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore
  ) {
    clock.runEveryEpoch(this.pollDuties);
    clock.runEverySlot(this.runSlotTasks);
  }

  private pollDuties = async (epoch: Epoch): Promise<void> => {
    for (const dutyEpoch of [epoch, epoch + 1]) {
      if (this.config.getForkSeq(computeStartSlotAtEpoch(dutyEpoch)) < ForkSeq.eip8453) continue;
      const indices = this.validatorStore.getAllLocalIndices();
      if (indices.length === 0) continue;
      try {
        const [headVotes, attesters] = await Promise.all([
          this.api.validator.getHeadVoteDuties({epoch: dutyEpoch, indices}),
          this.api.validator.getFinalityAttesterDuties({epoch: dutyEpoch, indices}),
        ]);
        this.headVoteDuties.set(dutyEpoch, headVotes.value());
        this.attesterDuties.set(dutyEpoch, attesters.value());
        for (const duty of attesters.value()) this.indexByPubkey.set(toRootHex(duty.pubkey), duty.validatorIndex);
        for (const duty of headVotes.value()) this.indexByPubkey.set(toRootHex(duty.pubkey), duty.validatorIndex);
      } catch (e) {
        this.logger.error("Error polling EIP-8453 duties", {epoch: dutyEpoch}, e as Error);
      }
    }
    for (const dutyEpoch of this.headVoteDuties.keys()) {
      if (dutyEpoch < epoch - 1) {
        this.headVoteDuties.delete(dutyEpoch);
        this.attesterDuties.delete(dutyEpoch);
      }
    }
  };

  private runSlotTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    if (this.config.getForkSeq(slot) < ForkSeq.eip8453) return;
    const epoch = computeEpochAtSlot(slot);
    const headVoters = (this.headVoteDuties.get(epoch) ?? []).filter((duty) => duty.slots.includes(slot));
    const attesters = (this.attesterDuties.get(epoch) ?? []).filter((duty) => duty.slot === slot);
    if (headVoters.length === 0 && attesters.length === 0) return;

    const slotMs = this.config.getSlotDurationMs(this.config.getForkName(slot));
    const delta = slotMs / 4;
    try {
      await sleep(delta - this.clock.msFromSlot(slot), signal);
      if (headVoters.length > 0) await this.castHeadVotes(slot, headVoters);
      await sleep(2 * delta - this.clock.msFromSlot(slot), signal);
      if (attesters.length > 0) await this.castFinalityAttestations(slot, epoch, attesters);
    } catch (e) {
      if (!signal.aborted) this.logger.error("Error on EIP-8453 duties", {slot}, e as Error);
    }
  };

  private async castHeadVotes(slot: Slot, duties: HeadVoteDuty[]): Promise<void> {
    const data = (await this.api.validator.produceHeadVoteData({slot})).value();
    const headVotes = await Promise.all(
      duties.map((duty) => this.validatorStore.signHeadVote(duty.pubkey, duty.validatorIndex, data))
    );
    (await this.api.validator.submitHeadVotes({headVotes})).assertOk();
    this.logger.debug("Published head votes", {
      slot,
      count: headVotes.length,
      root: toRootHex(data.beaconBlockRoot),
      payloadStatus: data.payloadStatus,
    });
  }

  private async castFinalityAttestations(slot: Slot, epoch: Epoch, duties: FinalityAttesterDuty[]): Promise<void> {
    const inputs = (await this.api.validator.produceFinalityAttestationInputs({slot})).value();
    const attestations: eip8453.SingleAttestation[] = [];
    for (const duty of duties) {
      const pubkeyHex = toRootHex(duty.pubkey);
      let record = this.records.get(pubkeyHex);
      if (record === undefined) {
        record = emptyFinalitySigningRecord();
        this.records.set(pubkeyHex, record);
      }
      const data = getFinalityAttestationData(record, inputs.target, inputs.justified, inputs.finalizedHeight);
      if (data === null) {
        this.logger.debug("Finality signing record suppresses the attestation", {
          slot,
          validatorIndex: duty.validatorIndex,
          targetHeight: inputs.target.height,
        });
        continue;
      }
      // Record before signing, as the spec requires
      recordFinalityAttestation(record, data);
      attestations.push(
        await this.validatorStore.signFinalityAttestation(
          duty.pubkey,
          duty.validatorIndex,
          duty.committeeIndex,
          inputs.epoch,
          data
        )
      );
    }
    if (attestations.length === 0) return;
    (await this.api.validator.submitFinalityAttestations({attestations})).assertOk();
    this.logger.debug("Published finality attestations", {
      slot,
      epoch,
      count: attestations.length,
      targetHeight: inputs.target.height,
      timeout: attestations[0].data.timeout,
      finalityHeight: attestations[0].data.finality.height,
    });
  }
}

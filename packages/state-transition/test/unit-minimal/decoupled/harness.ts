import {digest} from "@chainsafe/as-sha256";
import {SecretKey, aggregateSignatures} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  BUILDER_INDEX_SELF_BUILD,
  COMMITTEES_PER_ROUND,
  DOMAIN_AVAILABLE_CHAIN_ATTESTER,
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_RANDAO,
  EMPTY_HEIGHT,
  FAR_FUTURE_EPOCH,
  ForkName,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {Root, Slot, ValidatorIndex, decoupled, ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/block/externalData.js";
import {ProcessHeightEventsOpts} from "../../../src/block/processHeightEvents.js";
import {G2_POINT_AT_INFINITY} from "../../../src/constants/index.js";
import {
  CachedBeaconStateDecoupled,
  createCachedBeaconState,
  processSlots,
  stateTransition,
} from "../../../src/index.js";
import {
  computeAvailableChainCommittee,
  computeRoundAtSlot,
  getAttestationData2SigningRoot,
  getBeaconCommitteeDecoupled,
  readHeightPair,
} from "../../../src/util/decoupled.js";
import {computeEpochAtSlot, computeSigningRoot, getRandaoMix, interopSecretKeys} from "../../../src/util/index.js";

export const ZERO_ROOT = new Uint8Array(32);

export type HeightPairLike = {height: number; root: Uint8Array};

export type VoteOpts = {
  voters: ValidatorIndex[];
  /** Defaults to the round of the harness state's next block slot */
  round?: number;
  /** Defaults to the state's current target pair */
  target?: HeightPairLike | "current" | "empty" | "none";
  /** Defaults to "none" */
  finalize?: HeightPairLike | "justified" | "none";
};

export type BlockOpts = {
  attestations?: decoupled.Attestation[];
  attesterSlashings2?: decoupled.AttesterSlashing2[];
  availableChainAttestations?: decoupled.AvailableChainAttestation[];
} & ProcessHeightEventsOpts & {verifySignatures?: boolean};

export type HeightSnapshot = {
  target: HeightPairLike;
  justified: HeightPairLike;
  finalized: HeightPairLike;
  targetSlot: Slot;
  justifiedSlot: Slot;
  finalizedSlot: Slot;
};

/**
 * Scripted-votes harness: a minimal-preset decoupled genesis state whose validators sign real
 * attestations, and a block producer that runs the full state transition with those votes.
 */
export class DcHarness {
  readonly config: BeaconConfig;
  readonly secretKeys: SecretKey[];
  state: CachedBeaconStateDecoupled;
  /** Block roots by slot, filled as blocks are produced (slot 0 is the genesis block) */
  readonly blockRoots = new Map<Slot, Root>();

  constructor(readonly validatorCount = 64) {
    this.secretKeys = interopSecretKeys(validatorCount);
    const chainConfig = getConfig(ForkName.decoupled);
    const view = ssz.decoupled.BeaconState.defaultViewDU();
    this.config = createBeaconConfig(chainConfig, view.genesisValidatorsRoot);

    view.slot = 0;
    view.fork = ssz.phase0.Fork.toViewDU({
      previousVersion: chainConfig.DECOUPLED_FORK_VERSION,
      currentVersion: chainConfig.DECOUPLED_FORK_VERSION,
      epoch: 0,
    });
    view.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
      slot: 0,
      proposerIndex: 0,
      parentRoot: ZERO_ROOT,
      stateRoot: ZERO_ROOT,
      bodyRoot: ssz.decoupled.BeaconBlockBody.hashTreeRoot(ssz.decoupled.BeaconBlockBody.defaultValue()),
    });
    view.validators = ssz.gloas.Validators.toViewDU(
      this.secretKeys.map((sk) => ({
        pubkey: sk.toPublicKey().toBytes(),
        withdrawalCredentials: new Uint8Array(32).fill(1),
        effectiveBalance: MAX_EFFECTIVE_BALANCE,
        slashed: false,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      }))
    );
    const zeros = Array.from({length: validatorCount}, () => 0);
    view.balances = ssz.gloas.Balances.toViewDU(zeros.map(() => MAX_EFFECTIVE_BALANCE));
    view.inactivityScores = ssz.gloas.InactivityScores.toViewDU(zeros);
    view.previousEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(zeros);
    view.currentEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(zeros);
    view.heightParticipation = ssz.gloas.EpochParticipation.toViewDU(zeros);
    view.previousRoundParticipation = ssz.gloas.EpochParticipation.toViewDU(zeros);
    view.currentRoundParticipation = ssz.gloas.EpochParticipation.toViewDU(zeros);
    view.targetPair = ssz.decoupled.HeightPair.toViewDU({height: 1, root: ZERO_ROOT});
    view.justifiedPair = ssz.decoupled.HeightPair.toViewDU({height: 0, root: ZERO_ROOT});
    view.finalizedPair = ssz.decoupled.HeightPair.toViewDU({height: 0, root: ZERO_ROOT});
    // Validator 0 proposes every slot of the first two epochs, later epochs are computed by processEpoch
    view.proposerLookahead = ssz.fulu.ProposerLookahead.toViewDU(Array.from({length: 2 * SLOTS_PER_EPOCH}, () => 0));
    // A non-zero bid block hash marks the genesis parent payload as EMPTY for processParentExecutionPayload
    view.latestExecutionPayloadBid.blockHash = new Uint8Array(32).fill(0x01);
    view.randaoMixes = ssz.phase0.RandaoMixes.toViewDU(
      Array.from({length: view.randaoMixes.length}, () => new Uint8Array(32).fill(0x42))
    );

    const pubkeys = this.secretKeys.map((sk) => sk.toPublicKey().toBytes());
    const syncCommittee = {
      pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => pubkeys[i % validatorCount]),
      aggregatePubkey: pubkeys[0],
    };
    view.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);
    view.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);

    this.state = createCachedBeaconState(view, {config: this.config, pubkeyCache});
  }

  snapshot(state: CachedBeaconStateDecoupled = this.state): HeightSnapshot {
    return {
      target: readHeightPair(state.targetPair),
      justified: readHeightPair(state.justifiedPair),
      finalized: readHeightPair(state.finalizedPair),
      targetSlot: state.targetSlot,
      justifiedSlot: state.justifiedSlot,
      finalizedSlot: state.finalizedSlot,
    };
  }

  heightParticipation(): number[] {
    return Array.from(this.state.heightParticipation.getAll());
  }

  currentRoundParticipation(): number[] {
    return Array.from(this.state.currentRoundParticipation.getAll());
  }

  previousRoundParticipation(): number[] {
    return Array.from(this.state.previousRoundParticipation.getAll());
  }

  /** The genesis block root, known after the first slot has been processed */
  genesisRoot(): Root {
    const root = this.blockRoots.get(0);
    if (!root) throw Error("Process at least one slot first");
    return root;
  }

  /** Advance the harness state to `slot` without a block */
  advanceTo(slot: Slot): void {
    this.recordGenesisRoot(slot);
    this.state = processSlots(this.state, slot) as CachedBeaconStateDecoupled;
  }

  private recordGenesisRoot(slot: Slot): void {
    if (!this.blockRoots.has(0) && slot > 0) {
      // processSlot fills the genesis header's state root, hash a copy with the pre-state root
      const header = this.state.latestBlockHeader.toValue();
      header.stateRoot = this.state.hashTreeRoot();
      this.blockRoots.set(0, ssz.phase0.BeaconBlockHeader.hashTreeRoot(header));
    }
  }

  /**
   * Build and sign an attestation for `voters`. Committees are resolved against the state advanced to
   * `atSlot` (the slot of the block that will include it), which fixes the round when none is given.
   */
  vote(atSlot: Slot, opts: VoteOpts): decoupled.Attestation {
    const stateAtSlot = this.stateAt(atSlot);
    const round = opts.round ?? computeRoundAtSlot(atSlot);
    const targetOpt = opts.target ?? "current";
    const finalizeOpt = opts.finalize ?? "none";

    const targetPair: HeightPairLike =
      targetOpt === "current"
        ? readHeightPair(stateAtSlot.targetPair)
        : targetOpt === "empty"
          ? {height: stateAtSlot.targetPair.height, root: ZERO_ROOT}
          : targetOpt === "none"
            ? {height: EMPTY_HEIGHT, root: ZERO_ROOT}
            : targetOpt;
    const finalizePair: HeightPairLike =
      finalizeOpt === "justified"
        ? readHeightPair(stateAtSlot.justifiedPair)
        : finalizeOpt === "none"
          ? {height: EMPTY_HEIGHT, root: ZERO_ROOT}
          : finalizeOpt;

    const data: decoupled.AttestationData2 = {round, finalizePair, targetPair};
    return this.signAttestation(stateAtSlot, data, opts.voters);
  }

  signAttestation(
    stateAtSlot: CachedBeaconStateDecoupled,
    data: decoupled.AttestationData2,
    voters: ValidatorIndex[]
  ): decoupled.Attestation {
    const voterSet = new Set(voters);
    const committeeBits = BitArray.fromBitLen(COMMITTEES_PER_ROUND);
    const bits: boolean[] = [];
    for (let committeeIndex = 0; committeeIndex < COMMITTEES_PER_ROUND; committeeIndex++) {
      const committee = getBeaconCommitteeDecoupled(stateAtSlot, data.round, committeeIndex);
      if (!committee.some((index) => voterSet.has(index))) continue;
      committeeBits.set(committeeIndex, true);
      for (const index of committee) bits.push(voterSet.has(index));
    }

    const signingRoot = getAttestationData2SigningRoot(stateAtSlot, data);
    return {
      aggregationBits: BitArray.fromBoolArray(bits),
      signature: this.aggregate(voters, signingRoot),
      committeeBits,
      data,
    };
  }

  /** Build and sign an available chain attestation from the given committee members for `data.slot` */
  availableChainVote(
    atSlot: Slot,
    data: decoupled.AvailableChainAttestationData,
    voters: ValidatorIndex[]
  ): decoupled.AvailableChainAttestation {
    const domain = this.config.getDomain(atSlot, DOMAIN_AVAILABLE_CHAIN_ATTESTER, data.slot);
    const signingRoot = computeSigningRoot(ssz.decoupled.AvailableChainAttestationData, data, domain);
    return {
      attestingIndices: [...voters].sort((a, b) => a - b),
      data,
      signature: this.aggregate(voters, signingRoot),
    };
  }

  /** The available chain committee for `slot`, resolved against the state advanced to `atSlot` */
  availableChainCommittee(atSlot: Slot, slot: Slot): ValidatorIndex[] {
    return Array.from(new Set(computeAvailableChainCommittee(this.stateAt(atSlot), slot))).sort((a, b) => a - b);
  }

  indexedAttestation(
    atSlot: Slot,
    voters: ValidatorIndex[],
    data: decoupled.AttestationData2
  ): decoupled.IndexedAttestation2 {
    const signingRoot = getAttestationData2SigningRoot(this.stateAt(atSlot), data);
    return {
      attestingIndices: [...voters].sort((a, b) => a - b),
      data,
      signature: this.aggregate(voters, signingRoot),
    };
  }

  private aggregate(voters: ValidatorIndex[], signingRoot: Uint8Array): Uint8Array {
    const sigs = voters.map((index) => this.secretKeys[index].sign(signingRoot));
    return (sigs.length === 1 ? sigs[0] : aggregateSignatures(sigs)).toBytes();
  }

  private stateAt(slot: Slot): CachedBeaconStateDecoupled {
    if (slot === this.state.slot) return this.state;
    if (slot < this.state.slot) throw Error(`Harness state is already at slot ${this.state.slot} > ${slot}`);
    this.recordGenesisRoot(slot);
    return processSlots(this.state, slot) as CachedBeaconStateDecoupled;
  }

  /** Produce a block at `slot` with the given operations and apply it. Returns the new height snapshot. */
  produceBlock(slot: Slot, opts: BlockOpts = {}): HeightSnapshot {
    const stateAtSlot = this.stateAt(slot);
    const proposerIndex = stateAtSlot.epochCtx.getBeaconProposer(slot);
    const parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(stateAtSlot.latestBlockHeader.toValue());
    const epoch = computeEpochAtSlot(slot);

    const body = ssz.decoupled.BeaconBlockBody.defaultValue();
    body.randaoReveal = this.secretKeys[proposerIndex]
      .sign(computeSigningRoot(ssz.Epoch, epoch, this.config.getDomain(slot, DOMAIN_RANDAO, slot)))
      .toBytes();
    body.syncAggregate.syncCommitteeSignature = G2_POINT_AT_INFINITY;
    body.signedExecutionPayloadBid = {
      message: {
        ...ssz.heze.ExecutionPayloadBid.defaultValue(),
        parentBlockHash: stateAtSlot.latestBlockHash,
        parentBlockRoot: parentRoot,
        blockHash: digest(intToBytes(slot, 32)),
        prevRandao: getRandaoMix(stateAtSlot, epoch),
        builderIndex: BUILDER_INDEX_SELF_BUILD,
        slot,
        value: 0,
      },
      signature: G2_POINT_AT_INFINITY,
    };
    body.attestations = opts.attestations ?? [];
    body.attesterSlashings2 = opts.attesterSlashings2 ?? [];
    body.availableChainAttestations = opts.availableChainAttestations ?? [];

    const block: decoupled.BeaconBlock = {slot, proposerIndex, parentRoot, stateRoot: ZERO_ROOT, body};
    const signature = this.secretKeys[proposerIndex]
      .sign(computeSigningRoot(ssz.decoupled.BeaconBlock, block, this.config.getDomain(slot, DOMAIN_BEACON_PROPOSER)))
      .toBytes();

    const postState = stateTransition(
      this.state,
      {message: block, signature},
      {
        executionPayloadStatus: ExecutionPayloadStatus.valid,
        dataAvailabilityStatus: DataAvailabilityStatus.Available,
        verifyStateRoot: false,
        verifyProposer: true,
        verifySignatures: opts.verifySignatures ?? true,
        timeoutDelayRounds: opts.timeoutDelayRounds,
      }
    ) as CachedBeaconStateDecoupled;

    // The block carries a zero state root (verifyStateRoot is off), so the root the chain sees is the
    // header hashed with the real post-state root, which is what process_slot fills in next slot
    const header = postState.latestBlockHeader.toValue();
    header.stateRoot = postState.hashTreeRoot();
    this.blockRoots.set(slot, ssz.phase0.BeaconBlockHeader.hashTreeRoot(header));
    this.state = postState;
    return this.snapshot();
  }

  blockRoot(slot: Slot): Root {
    const root = this.blockRoots.get(slot);
    if (!root) throw Error(`No block produced at slot ${slot}`);
    return root;
  }
}

export function allValidators(count: number): ValidatorIndex[] {
  return Array.from({length: count}, (_, i) => i);
}

export function range(start: number, end: number): ValidatorIndex[] {
  return Array.from({length: end - start}, (_, i) => start + i);
}

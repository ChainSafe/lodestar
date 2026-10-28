import {digest} from "@chainsafe/as-sha256";
import {SecretKey, aggregateSignatures} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  ATTESTATION_COMMITTEES_PER_ROUND,
  BUILDER_INDEX_SELF_BUILD,
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_RANDAO,
  FAR_FUTURE_EPOCH,
  ForkName,
  MAX_EFFECTIVE_BALANCE,
  MIN_SEED_LOOKAHEAD,
  PAYLOAD_STATUS_PENDING,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {Epoch, Root, Slot, ValidatorIndex, eip8453, ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/block/externalData.js";
import {G2_POINT_AT_INFINITY} from "../../../src/constants/index.js";
import {CachedBeaconStateEip8453, createCachedBeaconState, processSlots, stateTransition} from "../../../src/index.js";
import {zeroHeightParticipation} from "../../../src/slot/upgradeStateToEip8453.js";
import {
  HeightCheckpointLike,
  computeHeadVoteCommittee,
  getAttestationCommittee,
  getFinalityAttestationSigningRoot,
  getHeadVoteCommittee,
  getHeadVoteSigningRoot,
  readHeightCheckpoint,
} from "../../../src/util/eip8453.js";
import {computeEpochAtSlot, computeSigningRoot, getRandaoMix, interopSecretKeys} from "../../../src/util/index.js";
import {zeroProgressiveListBasicRootNode} from "../../../src/util/ssz.js";

export const ZERO_ROOT = new Uint8Array(32);
export const EMPTY_CHECKPOINT: HeightCheckpointLike = {height: 0, root: ZERO_ROOT};

export type VoteOpts = {
  voters: ValidatorIndex[];
  /** Defaults to the state's current target checkpoint */
  target?: HeightCheckpointLike | "current";
  timeout?: boolean;
  /** Defaults to the empty checkpoint */
  finality?: HeightCheckpointLike | "justified" | "none";
  /** Defaults to the epoch of the inclusion slot */
  epoch?: Epoch;
};

export type BlockOpts = {
  attestations?: eip8453.Attestation[];
  headVotes?: eip8453.HeadVote[];
  /** One bit per voter of each head vote; defaults to all set for votes of the previous slot, none otherwise */
  headVoteSupport?: boolean[][];
  attesterSlashings?: eip8453.AttesterSlashing[];
  legacyAttesterSlashings?: eip8453.LegacyAttesterSlashings;
  verifySignatures?: boolean;
};

export type HeightSnapshot = {
  target: HeightCheckpointLike;
  justified: HeightCheckpointLike;
  finalized: HeightCheckpointLike;
  targetSlot: Slot;
  finalizedSlot: Slot;
  pendingHeights: number[];
};

/**
 * Scripted-votes harness: a minimal-preset EIP8453 genesis state whose validators sign real attestations and head
 * votes, and a block producer that runs the full state transition with those operations.
 */
export class Eip8453Harness {
  readonly config: BeaconConfig;
  readonly secretKeys: SecretKey[];
  state: CachedBeaconStateEip8453;
  /** Block roots by slot, filled as blocks are produced (slot 0 is the genesis block) */
  readonly blockRoots = new Map<Slot, Root>();

  constructor(readonly validatorCount = 64) {
    this.secretKeys = interopSecretKeys(validatorCount);
    const chainConfig = getConfig(ForkName.eip8453);
    const view = ssz.eip8453.BeaconState.defaultViewDU();
    this.config = createBeaconConfig(chainConfig, view.genesisValidatorsRoot);

    view.slot = 0;
    view.fork = ssz.phase0.Fork.toViewDU({
      previousVersion: chainConfig.EIP8453_FORK_VERSION,
      currentVersion: chainConfig.EIP8453_FORK_VERSION,
      epoch: 0,
    });
    view.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
      slot: 0,
      proposerIndex: 0,
      parentRoot: ZERO_ROOT,
      stateRoot: ZERO_ROOT,
      bodyRoot: ssz.eip8453.BeaconBlockBody.hashTreeRoot(ssz.eip8453.BeaconBlockBody.defaultValue()),
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
    view.targetParticipation = zeroHeightParticipation(validatorCount);
    view.progressParticipation = zeroHeightParticipation(validatorCount);
    view.roundParticipation = ssz.eip8453.RoundParticipation.getViewDU(
      zeroProgressiveListBasicRootNode(ssz.eip8453.RoundParticipation.itemsPerChunk, validatorCount)
    );
    view.targetCheckpoint = ssz.eip8453.HeightCheckpoint.toViewDU({height: 1, root: ZERO_ROOT});
    view.justifiedCheckpoint = ssz.eip8453.HeightCheckpoint.toViewDU(EMPTY_CHECKPOINT);
    view.finalizedCheckpoint = ssz.eip8453.HeightCheckpoint.toViewDU(EMPTY_CHECKPOINT);
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
    // initialize_head_vote_committee_window: committees of the current and lookahead epochs, no previous epoch
    const window = this.state.headVoteCommitteeWindow;
    for (let slot = 0; slot < (MIN_SEED_LOOKAHEAD + 1) * SLOTS_PER_EPOCH; slot++) {
      window.set(
        SLOTS_PER_EPOCH + slot,
        ssz.eip8453.HeadVoteCommittee.toViewDU(Array.from(computeHeadVoteCommittee(this.state, slot)))
      );
    }
    this.state.commit();
  }

  snapshot(state: CachedBeaconStateEip8453 = this.state): HeightSnapshot {
    return {
      target: readHeightCheckpoint(state.targetCheckpoint),
      justified: readHeightCheckpoint(state.justifiedCheckpoint),
      finalized: readHeightCheckpoint(state.finalizedCheckpoint),
      targetSlot: state.targetSlot,
      finalizedSlot: state.finalizedSlot,
      pendingHeights: state.pendingFinality.getAllReadonly().map((p) => p.checkpoint.height),
    };
  }

  targetParticipation(): boolean[] {
    return this.state.targetParticipation.getAll();
  }

  progressParticipation(): boolean[] {
    return this.state.progressParticipation.getAll();
  }

  roundParticipation(): number[] {
    return this.state.roundParticipation.getAll();
  }

  pendingParticipation(i: number): boolean[] {
    return this.state.pendingFinality.get(i).participation.getAll();
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
    this.state = processSlots(this.state, slot) as CachedBeaconStateEip8453;
  }

  private recordGenesisRoot(slot: Slot): void {
    if (!this.blockRoots.has(0) && slot > 0) {
      // processSlot fills the genesis header's state root, hash a copy with the pre-state root
      const header = this.state.latestBlockHeader.toValue();
      header.stateRoot = this.state.hashTreeRoot();
      this.blockRoots.set(0, ssz.phase0.BeaconBlockHeader.hashTreeRoot(header));
    }
  }

  /** The state advanced to `slot`, without mutating the harness */
  stateAt(slot: Slot): CachedBeaconStateEip8453 {
    if (slot === this.state.slot) return this.state;
    if (slot < this.state.slot) throw Error(`Harness state is already at slot ${this.state.slot} > ${slot}`);
    this.recordGenesisRoot(slot);
    return processSlots(this.state, slot) as CachedBeaconStateEip8453;
  }

  /**
   * Build and sign an FG attestation for `voters`. Committees are resolved against the state advanced to `atSlot`
   * (the slot of the block that will include it).
   */
  vote(atSlot: Slot, opts: VoteOpts): eip8453.Attestation {
    const stateAtSlot = this.stateAt(atSlot);
    const epoch = opts.epoch ?? computeEpochAtSlot(atSlot);
    const targetOpt = opts.target ?? "current";
    const finalityOpt = opts.finality ?? "none";

    const target = targetOpt === "current" ? readHeightCheckpoint(stateAtSlot.targetCheckpoint) : targetOpt;
    const finality =
      finalityOpt === "justified"
        ? readHeightCheckpoint(stateAtSlot.justifiedCheckpoint)
        : finalityOpt === "none"
          ? EMPTY_CHECKPOINT
          : finalityOpt;

    const data: eip8453.AttestationData = {target, timeout: opts.timeout ?? false, finality};
    return this.signAttestation(stateAtSlot, data, epoch, opts.voters);
  }

  signAttestation(
    stateAtSlot: CachedBeaconStateEip8453,
    data: eip8453.AttestationData,
    epoch: Epoch,
    voters: ValidatorIndex[]
  ): eip8453.Attestation {
    const voterSet = new Set(voters);
    const committeeBits = BitArray.fromBitLen(ATTESTATION_COMMITTEES_PER_ROUND);
    const bits: boolean[] = [];
    for (let committeeIndex = 0; committeeIndex < ATTESTATION_COMMITTEES_PER_ROUND; committeeIndex++) {
      const committee = getAttestationCommittee(stateAtSlot, epoch, committeeIndex);
      if (!committee.some((index) => voterSet.has(index))) continue;
      committeeBits.set(committeeIndex, true);
      for (const index of committee) bits.push(voterSet.has(index));
    }

    const signingRoot = getFinalityAttestationSigningRoot(stateAtSlot, data, epoch);
    return {
      aggregationBits: BitArray.fromBoolArray(bits),
      data,
      signature: this.aggregate(voters, signingRoot),
      committeeBits,
      epoch,
    };
  }

  indexedAttestation(
    atSlot: Slot,
    voters: ValidatorIndex[],
    data: eip8453.AttestationData,
    epoch: Epoch = computeEpochAtSlot(atSlot)
  ): eip8453.IndexedAttestation {
    const signingRoot = getFinalityAttestationSigningRoot(this.stateAt(atSlot), data, epoch);
    return {
      attestingIndices: [...voters].sort((a, b) => a - b),
      data,
      signature: this.aggregate(voters, signingRoot),
      epoch,
    };
  }

  /** The indexed attestation as the bigint type used in attester slashings */
  slashingAttestation(
    atSlot: Slot,
    voters: ValidatorIndex[],
    data: eip8453.AttestationData,
    epoch?: Epoch
  ): eip8453.IndexedAttestationBigint {
    return ssz.eip8453.IndexedAttestationBigint.deserialize(
      ssz.eip8453.IndexedAttestation.serialize(this.indexedAttestation(atSlot, voters, data, epoch))
    );
  }

  /** The head vote committee of `slot`, resolved against the state advanced to `atSlot` */
  headVoteCommittee(atSlot: Slot, slot: Slot): Uint32Array {
    return getHeadVoteCommittee(this.stateAt(atSlot), slot);
  }

  /**
   * Build and sign an aggregated head vote for `data.slot` from the committee members among `voters` (the whole
   * committee by default). Voters are listed once each, sorted, and sign once; `payloadStatus` defaults to
   * PENDING, which is what a vote for the block of its own slot must carry.
   */
  headVote(
    atSlot: Slot,
    data: Omit<eip8453.HeadVoteData, "payloadStatus"> & {payloadStatus?: number},
    voters?: ValidatorIndex[]
  ): eip8453.HeadVote {
    const stateAtSlot = this.stateAt(atSlot);
    const committee = getHeadVoteCommittee(stateAtSlot, data.slot);
    const voterSet = voters === undefined ? null : new Set(voters);
    const voterIndices = Array.from(new Set(committee))
      .filter((index) => voterSet === null || voterSet.has(index))
      .sort((a, b) => a - b);
    const voteData: eip8453.HeadVoteData = {
      slot: data.slot,
      beaconBlockRoot: data.beaconBlockRoot,
      payloadStatus: data.payloadStatus ?? PAYLOAD_STATUS_PENDING,
    };
    const signingRoot = getHeadVoteSigningRoot(stateAtSlot, voteData);
    return {voterIndices, data: voteData, signature: this.aggregate(voterIndices, signingRoot)};
  }

  private aggregate(signers: ValidatorIndex[], signingRoot: Uint8Array): Uint8Array {
    if (signers.length === 0) return G2_POINT_AT_INFINITY;
    const sigs = signers.map((index) => this.secretKeys[index].sign(signingRoot));
    return (sigs.length === 1 ? sigs[0] : aggregateSignatures(sigs)).toBytes();
  }

  /** Produce a block at `slot` with the given operations and apply it. Returns the new height snapshot. */
  produceBlock(slot: Slot, opts: BlockOpts = {}): HeightSnapshot {
    const stateAtSlot = this.stateAt(slot);
    const proposerIndex = stateAtSlot.epochCtx.getBeaconProposer(slot);
    const parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(stateAtSlot.latestBlockHeader.toValue());
    const epoch = computeEpochAtSlot(slot);

    const body = ssz.eip8453.BeaconBlockBody.defaultValue();
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
    body.headVotes = opts.headVotes ?? [];
    body.headVoteSupport = (
      opts.headVoteSupport ?? body.headVotes.map((vote) => vote.voterIndices.map(() => vote.data.slot === slot - 1))
    ).map((bits) => BitArray.fromBoolArray(bits));
    body.attesterSlashings = opts.attesterSlashings ?? [];
    body.legacyAttesterSlashings = opts.legacyAttesterSlashings ?? [];

    const block: eip8453.BeaconBlock = {slot, proposerIndex, parentRoot, stateRoot: ZERO_ROOT, body};
    const signature = this.secretKeys[proposerIndex]
      .sign(computeSigningRoot(ssz.eip8453.BeaconBlock, block, this.config.getDomain(slot, DOMAIN_BEACON_PROPOSER)))
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
      }
    ) as CachedBeaconStateEip8453;

    // The block carries a zero state root (verifyStateRoot is off), so the root the chain sees is the header hashed
    // with the real post-state root, which is what process_slot fills in next slot
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

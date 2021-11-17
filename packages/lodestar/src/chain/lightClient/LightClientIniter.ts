import {Proof, ProofType, TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {altair, phase0, Root, RootHex, Slot, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeSyncPeriodAtEpoch,
  computeSyncPeriodAtSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";
import {
  getNextSyncCommitteeProof,
  getSyncCommitteesProof,
  getSyncCommitteesWitness,
  SyncCommitteeWitness,
} from "./proofSyncCommittee";
import {MapDef, pruneSetToMax} from "../../util/map";
import {getFinalizedCheckpointWitness} from "./proofFinalizedCheckpoint";
import {GenesisData, GenesisWitness, getGenesisProof, getGenesisWitness} from "./proofGenesis";
import {Repository} from "@chainsafe/lodestar-db";
import {BitVector, toHexString} from "@chainsafe/ssz";

type SyncCommitteePeriod = number;
type DependantRootHex = RootHex;
type BlockRoot = Uint8Array;
type BlockRooHex = RootHex;

type SyncAttestedData = {
  header: phase0.BeaconBlockHeader;
  /** Precomputed root to prevent re-hashing */
  blockRoot: Uint8Array;
} & (
  | {
      isFinalized: true;
      finalityBranch: Uint8Array[];
      finalizedCheckpoint: phase0.Checkpoint;
    }
  | {
      isFinalized: false;
      header: phase0.BeaconBlockHeader;
    }
);

type PartialLightClientUpdate = altair.SyncAggregate & {
  header: phase0.BeaconBlockHeader;
  /** Precomputed root to prevent re-hashing */
  blockRoot: Uint8Array;
} & (
    | {
        isFinalized: true;
        finalityBranch: Uint8Array[];
        finalizedCheckpoint: phase0.Checkpoint;
        finalizedHeader: phase0.BeaconBlockHeader;
      }
    | {
        isFinalized: false;
        header: phase0.BeaconBlockHeader;
      }
  );

interface ILightClientIniterModules {
  config: IChainForkConfig;
  db: IBeaconDb;
  forkChoice: ForkChoice;
}

/* paths needed to bootstrap the light client */
export const stateProofPaths = [
  // initial sync committee list
  ["currentSyncCommittee"],
  ["nextSyncCommittee"],
  // required to initialize a slot clock
  ["genesisTime"],
  // required to verify signatures
  ["genesisValidatorsRoot"],
];

const syncProofLeavesLength = SYNC_COMMITTEE_SIZE * 2 + 2;

const MAX_CACHED_FINALIZED_HEADERS = 3;

/**
 * Compute and cache "init" proofs as the chain advances.
 * Will compute proofs for:
 * - All finalized blocks
 * - All non-finalized checkpoint blocks
 *
 * Params:
 * - How many epochs ago do you consider a re-org can happen? 10
 * - How many consecutive slots in a epoch you consider can be skipped? 32
 *
 * ### What data to store?
 *
 * An altair beacon state has 24 fields, with a depth of 5.
 * | field                 | gindex | index |
 * | --------------------- | ------ | ----- |
 * | genesisTime           | 32     | 0     |
 * | genesisValidatorsRoot | 33     | 1     |
 * | currentSyncCommittee  | 54     | 22    |
 * | nextSyncCommittee     | 55     | 23    |
 * | finalizedCheckpoint   | 52     | 20    |
 *
 * For each field you only need 5 x 32 witness. Since genesisTime and genesisValidatorsRoot are mutual witness
 * of each other, never change and are always known you only 4 witness for each, or 4 witness for both.
 *
 * TODO: Is the GenesisWitness proof really necessary? For any network this info is known in advance.
 *
 * ```ts
 * GenesisWitness = Vector[Bytes32, 4]
 * ```
 *
 * Fields `currentSyncCommittee` and `nextSyncCommittee` are also contiguous fields. Since they rarely change its
 * more optimal to only store the witnesses different blocks of interest.
 *
 * ```ts
 * SyncCommitteeWitness = Container({
 *   witness: Vector[Bytes32, 4],
 *   currentSyncCommitteeRoot: Bytes32,
 *   nextSyncCommitteeRoot: Bytes32,
 * })
 * ```
 *
 * To produce finalized light-client updates, need the FinalizedCheckpointWitness + the finalized header the checkpoint
 * points too. It's cheaper to send a full BeaconBlockHeader `3*32 + 2*8` than a proof to `state_root` `(3+1)*32`.
 *
 * ```ts
 * FinalizedCheckpointWitness = Container({
 *   witness: Vector[Bytes32, 5],
 *   root: Bytes32,
 *   epoch: Epoch,
 * })
 * ```
 *
 * ### When to store data?
 *
 * Lightclient servers don't really need to support serving data for light-client at all possible roots to have a
 * functional use-case.
 * - For init proofs light-clients will probably use a finalized weak-subjectivity checkpoint
 * - For sync updates, light-clients need any update within a given period
 *
 * Fully tree-backed states are not guaranteed to be available at any time but just after processing a block. Then,
 * the server must pre-compute all data for all blocks until there's certainity of what block becomes a checkpoint
 * and which blocks doesn't.
 *
 * - SyncAggregate -> ParentBlock -> FinalizedCheckpoint -> nextSyncCommittee
 *
 * After importing a new block + postState:
 * - Persist GenesisWitness, indexed by block root of state's witness, always
 * - Persist SyncCommitteeWitness, indexed by block root of state's witness, always
 * - Persist currentSyncCommittee, indexed by hashTreeRoot, once (not necessary after the first run)
 * - Persist nextSyncCommittee, indexed by hashTreeRoot, for each period + dependantRoot
 * - Persist FinalizedCheckpointWitness only if checkpoint period = syncAggregate period
 *
 * TODO: Prune strategy:
 * - [Low value] On finalized or in finalized lookup, prune SyncCommittee that's not finalized
 * - [High value] After some time prune un-used FinalizedCheckpointWitness + finalized headers
 * - [High value] After some time prune to-be-checkpoint items that will never become checkpoints
 * - After sync period is over all pending headers are useless
 *
 * !!! BEST = finalized + highest bit count + oldest (less chance of re-org, less writes)
 *
 * Then when light-client requests the best finalized update at period N:
 * - Fetch best finalized SyncAggregateHeader in period N
 * - Fetch FinalizedCheckpointWitness at that header's block root
 * - Fetch SyncCommitteeWitness at that FinalizedCheckpointWitness.header.root
 * - Fetch SyncCommittee at that SyncCommitteeWitness.nextSyncCommitteeRoot
 *
 * When light-client request best non-finalized update at period N:
 * - Fetch best non-finalized SyncAggregateHeader in period N
 * - Fetch SyncCommitteeWitness at that SyncAggregateHeader.header.root
 * - Fetch SyncCommittee at that SyncCommitteeWitness.nextSyncCommitteeRoot
 *
 * ```
 *                       Finalized               Block   Sync
 *                       Checkpoint              Header  Aggreate
 * ----------------------|-----------------------|-------|---------> time
 *                        <---------------------   <----
 *                         finalizes               signs
 * ```
 *
 * ### What's the cost of this data?
 *
 * To estimate the data costs, let's analyze monthly. Yearly may not make sense due to weak subjectivity:
 * - 219145 slots / month
 * - 6848 epochs / month
 * - 27 sync periods / month
 *
 * The byte size of a SyncCommittee (mainnet preset) is fixed to `48 * (512 + 1) = 24624`. So with SyncCommittee only
 * the data cost to store them is `24624 * 27 = 664848` ~ 0.6 MB/m.
 *
 * Storing 4 witness per block costs `219145 * 4 * 32 = 28050560 ~ 28 MB/m`.
 * Storing 4 witness per epoch costs `6848 * 4 * 32 = 876544 ~ 0.9 MB/m`.
 */
export class LightClientIniter {
  private readonly db: IBeaconDb & {
    genesisWitness: Repository<BlockRoot, GenesisWitness>;
    syncCommitteeWitness: Repository<BlockRoot, SyncCommitteeWitness>;
    syncCommittee: Repository<Uint8Array, altair.SyncCommittee>;
    finalizedHeader: Repository<BlockRoot, phase0.BeaconBlockHeader>;
    bestPartialLightClientUpdate: Repository<SyncPeriod, PartialLightClientUpdate>;
  };

  private readonly config: IChainForkConfig;
  private readonly forkChoice: ForkChoice;
  private readonly knownSyncCommittee = new MapDef<SyncCommitteePeriod, Set<DependantRootHex>>(() => new Set());
  private storedCurrentSyncCommittee = false;
  private readonly genesisData: GenesisData;
  /**
   * Keep in memory since this data is very transient, not useful after a few slots
   */
  private readonly prevHeadData = new Map<BlockRooHex, SyncAttestedData>();
  private finalizedHeaders = new Map<BlockRooHex, phase0.BeaconBlockHeader>();

  private readonly zero: Pick<altair.LightClientUpdate, "finalityBranch" | "finalityHeader">;

  constructor(modules: ILightClientIniterModules) {
    this.config = modules.config;
    this.db = modules.db;
    this.forkChoice = modules.forkChoice;

    this.zero = {
      finalityHeader: ssz.phase0.BeaconBlockHeader.defaultValue(),
      finalityBranch: ssz.altair.LightClientUpdate.getPropertyType(
        "finalityBranch"
      ).defaultValue() as altair.LightClientUpdate["finalityBranch"],
    };
  }

  async onImportBlock(
    block: allForks.BeaconBlock,
    postState: CachedBeaconState<allForks.BeaconState>,
    dependantRoot: RootHex,
    parentBlockSlot: Slot
  ): Promise<void> {
    const blockSlot = block.slot;

    const header: phase0.BeaconBlockHeader = {
      slot: blockSlot,
      proposerIndex: block.proposerIndex,
      parentRoot: block.parentRoot,
      stateRoot: block.stateRoot,
      bodyRoot: this.config.getForkTypes(blockSlot).BeaconBlockBody.hashTreeRoot(block.body),
    };

    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
    const blockRootHex = toHexString(blockRoot);

    // Store genesis witness in case this block becomes a checkpoint
    const genesisWitness = getGenesisWitness(postState);
    await this.db.genesisWitness.put(blockRoot, genesisWitness);

    const syncCommitteeWitness = getSyncCommitteesWitness(postState);

    // Only store current sync committee once per run
    if (!this.storedCurrentSyncCommittee) {
      await this.storeSyncCommittee(postState.currentSyncCommittee, syncCommitteeWitness.currentSyncCommitteeRoot);
      this.storedCurrentSyncCommittee = true;
    }

    // Only store next sync committee once per dependant root
    const parentBlockPeriod = computeSyncPeriodAtSlot(parentBlockSlot);
    const period = computeSyncPeriodAtSlot(blockSlot);
    if (parentBlockPeriod < period) {
      const periodDependantRoots = this.knownSyncCommittee.getOrDefault(period);
      if (!periodDependantRoots.has(dependantRoot)) {
        periodDependantRoots.add(dependantRoot);
        await this.storeSyncCommittee(postState.nextSyncCommittee, syncCommitteeWitness.nextSyncCommitteeRoot);
      }
    }

    // Ensure referenced syncCommittee are persisted before persiting this one
    await this.db.syncCommitteeWitness.put(blockRoot, syncCommitteeWitness);

    // Store header in case it is referenced latter by a future finalized checkpoint
    await this.db.finalizedHeader.put(blockRoot, header);

    // Store finalized checkpoint data
    const finalizedCheckpoint = postState.finalizedCheckpoint;
    const finalizedCheckpointPeriod = computeSyncPeriodAtEpoch(finalizedCheckpoint.epoch);
    const isFinalized = finalizedCheckpointPeriod === period;

    this.prevHeadData.set(
      blockRootHex,
      isFinalized
        ? {
            isFinalized: true,
            header,
            blockRoot,
            finalityBranch: getFinalizedCheckpointWitness(postState),
            finalizedCheckpoint,
          }
        : {
            isFinalized: false,
            header,
            blockRoot,
          }
    );
  }

  /**
   * 1. Subscribe to gossip topics `sync_committee_{subnet_id}` and collect `sync_committee_message`
   * ```
   * slot: Slot
   * beacon_block_root: Root
   * validator_index: ValidatorIndex
   * signature: BLSSignature
   * ```
   *
   * 2. Subscribe to `sync_committee_contribution_and_proof` and collect `signed_contribution_and_proof`
   * ```
   * slot: Slot
   * beacon_block_root: Root
   * subcommittee_index: uint64
   * aggregation_bits: Bitvector[SYNC_COMMITTEE_SIZE // SYNC_COMMITTEE_SUBNET_COUNT]
   * signature: BLSSignature
   * ```
   *
   * 3. On new blocks use `block.body.sync_aggregate`, `block.parent_root` and `block.slot - 1`
   */
  async onSyncAggregate(syncAggregate: altair.SyncAggregate, signedBlockRoot: Root, slot: Slot): Promise<void> {
    const signedBlockRootHex = toHexString(signedBlockRoot);
    const prevHeadData = this.prevHeadData.get(signedBlockRootHex);
    if (!prevHeadData) {
      throw Error("prevHeadData not available");
    }

    // Check if this update is better, otherwise ignore
    const period = computeSyncPeriodAtSlot(slot);
    const prevBestUpdate = await this.db.bestPartialLightClientUpdate.get(period);
    if (prevBestUpdate && !isBetterUpdate(prevBestUpdate, syncAggregate, prevHeadData)) {
      // TODO: Do metrics on how often updates are overwritten
      return;
    }

    const newPartialUpdate: PartialLightClientUpdate = prevHeadData.isFinalized
      ? {
          ...prevHeadData,
          finalizedHeader: await this.getFinalizedHeader(prevHeadData.finalizedCheckpoint.root as Uint8Array),
          syncCommitteeBits: syncAggregate.syncCommitteeBits,
          syncCommitteeSignature: syncAggregate.syncCommitteeSignature,
        }
      : {
          ...prevHeadData,
          syncCommitteeBits: syncAggregate.syncCommitteeBits,
          syncCommitteeSignature: syncAggregate.syncCommitteeSignature,
        };

    await this.db.bestPartialLightClientUpdate.put(period, newPartialUpdate);
  }

  /**
   * API ROUTE to get `genesisTime` and `genesisValidatorsRoot` from a trusted state root
   */
  async serveInitProof(blockRoot: Uint8Array): Promise<Proof> {
    const genesisWitness = await this.db.genesisWitness.get(blockRoot);
    if (!genesisWitness) {
      throw Error("Not available");
    }

    return getGenesisProof(genesisWitness, this.genesisData);
  }

  /**
   * API ROUTE to get `currentSyncCommittee` and `nextSyncCommittee` from a trusted state root
   */
  async serveInitCommittees(blockRoot: Uint8Array): Promise<Proof> {
    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(blockRoot);
    if (!syncCommitteeWitness) {
      throw Error(`syncCommitteeWitness not available ${toHexString(blockRoot)}`);
    }

    const [currentSyncCommittee, nextSyncCommittee] = await Promise.all([
      this.db.syncCommittee.get(syncCommitteeWitness.currentSyncCommitteeRoot),
      this.db.syncCommittee.get(syncCommitteeWitness.nextSyncCommitteeRoot),
    ]);
    if (!currentSyncCommittee) {
      throw Error("currentSyncCommittee not available");
    }
    if (!nextSyncCommittee) {
      throw Error("nextSyncCommittee not available");
    }

    return getSyncCommitteesProof(syncCommitteeWitness, {currentSyncCommittee, nextSyncCommittee});
  }

  /**
   * API ROUTE to get the best available update for `period` to transition to the next sync committee.
   * Criteria for best in priority order:
   * - Is finalized
   * - Has the most bits
   * - Signed header at the oldest slot
   */
  async serveFinalizedPeriodUpdate(period: SyncPeriod): Promise<altair.LightClientUpdate> {
    // Signature data
    const partialUpdate = await this.db.bestPartialLightClientUpdate.get(period);
    if (!partialUpdate) {
      throw Error(`Not updated available for period ${period}`);
    }

    const syncCommitteeWitnessBlockRoot = partialUpdate.isFinalized
      ? (partialUpdate.finalizedCheckpoint.root as Uint8Array)
      : partialUpdate.blockRoot;

    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(syncCommitteeWitnessBlockRoot);
    if (!syncCommitteeWitness) {
      throw Error(`finalizedBlockRoot not available ${toHexString(syncCommitteeWitnessBlockRoot)}`);
    }

    const nextSyncCommittee = await this.db.syncCommittee.get(syncCommitteeWitness.nextSyncCommitteeRoot);
    if (!nextSyncCommittee) {
      throw Error("nextSyncCommittee not available");
    }

    if (partialUpdate.isFinalized) {
      return {
        header: partialUpdate.finalizedHeader,
        nextSyncCommittee: nextSyncCommittee,
        nextSyncCommitteeBranch: getNextSyncCommitteeProof(syncCommitteeWitness),
        finalityHeader: partialUpdate.header,
        finalityBranch: partialUpdate.finalityBranch,
        syncCommitteeBits: partialUpdate.syncCommitteeBits,
        syncCommitteeSignature: partialUpdate.syncCommitteeSignature,
        forkVersion: this.config.getForkVersion(partialUpdate.header.slot),
      };
    } else {
      return {
        header: partialUpdate.header,
        nextSyncCommittee: nextSyncCommittee,
        nextSyncCommitteeBranch: getNextSyncCommitteeProof(syncCommitteeWitness),
        finalityHeader: this.zero.finalityHeader,
        finalityBranch: this.zero.finalityBranch,
        syncCommitteeBits: partialUpdate.syncCommitteeBits,
        syncCommitteeSignature: partialUpdate.syncCommitteeSignature,
        forkVersion: this.config.getForkVersion(partialUpdate.header.slot),
      };
    }
  }

  /**
   * With forkchoice data compute which block roots will never become checkpoints and prune them.
   */
  async pruneNonCheckpointData(nonCheckpointBlockRoots: Uint8Array[]): Promise<void> {
    // TODO: Batch delete with native leveldb batching not just Promise.all()
    await Promise.all([
      this.db.genesisWitness.batchDelete(nonCheckpointBlockRoots),
      this.db.syncCommitteeWitness.batchDelete(nonCheckpointBlockRoots),
      this.db.finalizedHeader.batchDelete(nonCheckpointBlockRoots),
    ]);
  }

  /**
   * Must subscribe to BeaconChain event `finalized`
   *
   * Store a light client init proof and related indices and prune old entries
   */
  async onFinalized(checkpoint: phase0.Checkpoint): Promise<void> {
    const checkpointRoot = checkpoint.root.valueOf() as Uint8Array;
    const checkpointBlockSummary = this.forkChoice.getBlock(checkpointRoot);
    if (!checkpointBlockSummary) {
      throw new Error("Block not found in fork choice");
    }
    const checkpointBlockSlot = checkpointBlockSummary.slot;
    const checkpointBlockEpoch = Math.floor(checkpointBlockSlot / SLOTS_PER_EPOCH);
    // discard any states that occur before altair
    if (checkpointBlockEpoch < this.config.ALTAIR_FORK_EPOCH) {
      return;
    }

    // fetch the state at the block header, this state will be used to create the init proof
    const checkpointStateRoot = checkpointBlockSummary.stateRoot;
    const checkpointState = this.stateCache.get(checkpointStateRoot);
    if (!checkpointState) {
      throw new Error("State not found in cache");
    }

    // state proof
    const stateProof = checkpointState.createProof(stateProofPaths) as TreeOffsetProof;

    // sync committees stored separately to deduplicate
    const currentPeriod = computeSyncPeriodAtEpoch(checkpointBlockEpoch);
    const nextPeriod = currentPeriod + 1;

    // Create sync committee proofs by _splicing_ the committee sections out of the state proof

    stateProof.offsets.splice(7, 2);

    const currentSyncCommitteeProof: TreeOffsetProof = {
      type: ProofType.treeOffset,
      offsets: stateProof.offsets.splice(7, 1025),
      leaves: stateProof.leaves.splice(7, 1026),
    };

    const nextSyncCommitteeProof: TreeOffsetProof = {
      type: ProofType.treeOffset,
      offsets: stateProof.offsets.splice(7, 1025),
      leaves: stateProof.leaves.splice(7, 1026),
    };

    // calculate beginning of weak subjectivity period to prune from there
    const wsPeriod = allForks.computeWeakSubjectivityPeriodCachedState(this.config, checkpointState);
    const wsEpoch = Math.max(0, checkpointState.finalizedCheckpoint.epoch - wsPeriod);
    const wsSyncPeriod = computeSyncPeriodAtEpoch(wsEpoch);

    // index stored as ${epoch}${blockRoot}
    const oldStateProofIndexKeys = await this.db.lightClientInitProofIndex.keys({lt: intToBytes(wsEpoch, 8)});
    // slice off epoch to retrieve block roots
    const oldStateProofBlockRoots = oldStateProofIndexKeys.map((indexKey) => indexKey.subarray(8));
    const oldCommitteeProofKeys = await this.db.lightClientSyncCommitteeProof.keys({lt: wsSyncPeriod});

    // serialize the checkpoint for the init proof index
    // For easy pruning, the epoch is first
    const serializedCheckpoint = new Uint8Array(40);
    serializedCheckpoint.set(ssz.Epoch.serialize(checkpoint.epoch));
    serializedCheckpoint.set(checkpointRoot, 8);

    await Promise.all([
      // prune old proofs
      this.db.lightClientInitProofIndex.batchDelete(oldStateProofIndexKeys),
      this.db.lightClientInitProof.batchDelete(oldStateProofBlockRoots),
      this.db.lightClientSyncCommitteeProof.batchDelete(oldCommitteeProofKeys),
      // store state proof
      this.db.lightClientInitProofIndex.put(serializedCheckpoint, true),
      this.db.lightClientInitProof.put(checkpointRoot, stateProof),
      // store sync committee proofs
      this.db.lightClientSyncCommitteeProof.batchPut([
        {key: currentPeriod, value: currentSyncCommitteeProof},
        {key: nextPeriod, value: nextSyncCommitteeProof},
      ]),
    ]);
  }

  private async storeSyncCommittee(syncCommittee: altair.SyncCommittee, syncCommitteeRoot: Uint8Array): Promise<void> {
    const isKnown = await this.db.syncCommittee.has(syncCommitteeRoot);
    if (!isKnown) {
      await this.db.syncCommittee.put(syncCommitteeRoot, syncCommittee);
    }
  }

  /**
   * Get finalized header from db. Keeps a small in-memory cache to speed up most of the lookups
   */
  private async getFinalizedHeader(finalizedBlockRoot: Uint8Array): Promise<phase0.BeaconBlockHeader> {
    const finalizedBlockRootHex = toHexString(finalizedBlockRoot);
    const cachedFinalizedHeader = this.finalizedHeaders.get(finalizedBlockRootHex);
    if (cachedFinalizedHeader) {
      return cachedFinalizedHeader;
    }

    const finalizedHeader = await this.db.finalizedHeader.get(finalizedBlockRoot);
    if (!finalizedHeader) {
      throw Error(`finalityHeader not available ${toHexString(finalizedBlockRoot)}`);
    }

    this.finalizedHeaders.set(finalizedBlockRootHex, finalizedHeader);
    pruneSetToMax(this.finalizedHeaders, MAX_CACHED_FINALIZED_HEADERS);

    return finalizedHeader;
  }
}

/**
 * Returns the update with more bits. On ties, prevUpdate is the better
 *
 * Spec v1.0.1
 * ```python
 * max(store.valid_updates, key=lambda update: sum(update.sync_committee_bits)))
 * ```
 */
export function isBetterUpdate(
  prevUpdate: PartialLightClientUpdate,
  nextSyncAggregate: altair.SyncAggregate,
  nextSyncAttestedData: SyncAttestedData
): boolean {
  // Finalized is always better
  if (!prevUpdate.isFinalized && nextSyncAttestedData.isFinalized) {
    return true;
  }

  // Higher bit count
  const prevBitCount = sumBits(prevUpdate.syncCommitteeBits);
  const nextBitCount = sumBits(nextSyncAggregate.syncCommitteeBits);
  if (prevBitCount > nextBitCount) return false;
  if (prevBitCount < nextBitCount) return true;

  // else keep the oldest, lowest chance or re-org and requires less updating
  return prevUpdate.header.slot < nextSyncAttestedData.header.slot;
}

export function sumBits(bits: BitVector): number {
  let sum = 0;
  for (const bit of bits) {
    if (bit) {
      sum++;
    }
  }
  return sum;
}

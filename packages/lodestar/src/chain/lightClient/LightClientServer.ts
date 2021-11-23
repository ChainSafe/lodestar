import {altair, phase0, Root, RootHex, Slot, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {
  CachedBeaconState,
  computeSyncPeriodAtEpoch,
  computeSyncPeriodAtSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {BitVector, toHexString} from "@chainsafe/ssz";
import {IBeaconDb} from "../../db";
import {MapDef, pruneSetToMax} from "../../util/map";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {getNextSyncCommitteeBranch, getSyncCommitteesWitness, getFinalizedRootProof, getGenesisWitness} from "./proofs";
import {PartialLightClientUpdate, InitGenesisProof, InitSnapshotProof} from "./types";
import {SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";

type DependantRootHex = RootHex;
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
    }
);

type GenesisData = {
  genesisTime: number;
  genesisValidatorsRoot: Uint8Array;
};

interface ILightClientIniterModules {
  config: IChainForkConfig;
  db: IBeaconDb;
  emitter: ChainEventEmitter;
  logger: ILogger;
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

const MAX_CACHED_FINALIZED_HEADERS = 3;
const MAX_PREV_HEAD_DATA = 32;

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
 * | finalizedCheckpoint   | 52     | 20    |
 * | currentSyncCommittee  | 54     | 22    |
 * | nextSyncCommittee     | 55     | 23    |
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
export class LightClientServer {
  private readonly db: IBeaconDb;
  private readonly config: IChainForkConfig;
  private readonly emitter: ChainEventEmitter;
  private readonly logger: ILogger;
  private readonly knownSyncCommittee = new MapDef<SyncPeriod, Set<DependantRootHex>>(() => new Set());
  private storedCurrentSyncCommittee = false;

  /**
   * Keep in memory since this data is very transient, not useful after a few slots
   */
  private readonly prevHeadData = new Map<BlockRooHex, SyncAttestedData>();
  private finalizedHeaders = new Map<BlockRooHex, phase0.BeaconBlockHeader>();

  private readonly zero: Pick<altair.LightClientUpdate, "finalityBranch" | "finalityHeader">;

  constructor(modules: ILightClientIniterModules, private readonly genesisData: GenesisData) {
    this.config = modules.config;
    this.db = modules.db;
    this.emitter = modules.emitter;
    this.logger = modules.logger;

    this.zero = {
      finalityHeader: ssz.phase0.BeaconBlockHeader.defaultValue(),
      finalityBranch: ssz.altair.LightClientUpdate.getPropertyType(
        "finalityBranch"
      ).defaultValue() as altair.LightClientUpdate["finalityBranch"],
    };
  }

  /**
   * Call after importing a block, having the postState available in memory for proof generation.
   * - Persist state witness
   * - Use block's syncAggregate
   */
  onImportBlock(
    block: altair.BeaconBlock,
    postState: CachedBeaconState<allForks.BeaconState>,
    parentBlock: {blockRoot: RootHex; slot: Slot}
  ): void {
    // What is the syncAggregate signing?
    // From the beacon-state-transition
    // ```
    // const previousSlot = Math.max(block.slot, 1) - 1;
    // const rootSigned = getBlockRootAtSlot(state, previousSlot);
    // ```
    // In skipped slots the next value of blockRoots is set to the last block root.
    // So rootSigned will always equal to the parentBlock.
    const signedBlockRoot = block.parentRoot;

    this.onSyncAggregate(block.body.syncAggregate, signedBlockRoot).catch((e) => {
      this.logger.error("Error onSyncAggregate", {}, e);
    });

    this.persistPostBlockImportData(block, postState, parentBlock).catch((e) => {
      this.logger.error("Error persistPostBlockImportData", {}, e);
    });
  }

  /**
   * API ROUTE to get `genesisTime` and `genesisValidatorsRoot` from a trusted state root
   */
  async serveInitProof(blockRoot: Uint8Array): Promise<InitGenesisProof> {
    const genesisWitness = await this.db.genesisWitness.get(blockRoot);
    if (!genesisWitness) {
      throw Error("Not available");
    }

    return {
      genesisTime: this.genesisData.genesisTime,
      genesisValidatorsRoot: this.genesisData.genesisValidatorsRoot,
      branch: genesisWitness,
    };
  }

  /**
   * API ROUTE to get `currentSyncCommittee` and `nextSyncCommittee` from a trusted state root
   */
  async serveInitCommittees(blockRoot: Uint8Array): Promise<InitSnapshotProof> {
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

    const header = await this.db.finalizedHeader.get(blockRoot);
    if (!header) {
      throw Error("header not available");
    }

    return {
      header,
      currentSyncCommittee,
      nextSyncCommittee,
      syncCommitteesBranch: syncCommitteeWitness.witness,
    };
  }

  /**
   * API ROUTE to get the best available update for `period` to transition to the next sync committee.
   * Criteria for best in priority order:
   * - Is finalized
   * - Has the most bits
   * - Signed header at the oldest slot
   */
  async serveBestUpdateInPeriod(period: SyncPeriod): Promise<altair.LightClientUpdate> {
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
        nextSyncCommitteeBranch: getNextSyncCommitteeBranch(syncCommitteeWitness),
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
        nextSyncCommitteeBranch: getNextSyncCommitteeBranch(syncCommitteeWitness),
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

  private async persistPostBlockImportData(
    block: altair.BeaconBlock,
    postState: CachedBeaconState<allForks.BeaconState>,
    parentBlock: {blockRoot: RootHex; slot: Slot}
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
    const parentBlockPeriod = computeSyncPeriodAtSlot(parentBlock.slot);
    const period = computeSyncPeriodAtSlot(blockSlot);
    if (parentBlockPeriod < period) {
      // If the parentBlock is in a previous epoch it must be the dependantRoot of this epoch transition
      const dependantRoot = parentBlock.blockRoot;
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
            finalityBranch: getFinalizedRootProof(postState),
            finalizedCheckpoint,
          }
        : {
            isFinalized: false,
            header,
            blockRoot,
          }
    );

    pruneSetToMax(this.prevHeadData, MAX_PREV_HEAD_DATA);
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
  private async onSyncAggregate(syncAggregate: altair.SyncAggregate, signedBlockRoot: Root): Promise<void> {
    const signedBlockRootHex = toHexString(signedBlockRoot);
    const attestedData = this.prevHeadData.get(signedBlockRootHex);
    if (!attestedData) {
      throw Error("attestedData not available");
    }

    // Emit update
    // - At the earliest: 6 second after the slot start
    // - After a new update has INCREMENT_THRESHOLD == 32 bits more than the previous emitted threshold
    this.emitter.emit(ChainEvent.lightclientUpdate, {
      header: attestedData.header,
      blockRoot: toHexString(attestedData.blockRoot),
      syncAggregate,
    });

    // Check if this update is better, otherwise ignore
    await this.maybeStoreNewBestPartialUpdate(syncAggregate, attestedData);
  }

  /**
   * Given a new `syncAggregate` maybe persist a new best partial update if its better than the current stored for
   * that sync period.
   */
  private async maybeStoreNewBestPartialUpdate(
    syncAggregate: altair.SyncAggregate,
    attestedData: SyncAttestedData
  ): Promise<void> {
    const period = computeSyncPeriodAtSlot(attestedData.header.slot);
    const prevBestUpdate = await this.db.bestPartialLightClientUpdate.get(period);
    if (prevBestUpdate && !isBetterUpdate(prevBestUpdate, syncAggregate, attestedData)) {
      // TODO: Do metrics on how often updates are overwritten
      return;
    }

    const newPartialUpdate: PartialLightClientUpdate = attestedData.isFinalized
      ? {
          ...attestedData,
          finalizedHeader: await this.getFinalizedHeader(attestedData.finalizedCheckpoint.root as Uint8Array),
          syncCommitteeBits: syncAggregate.syncCommitteeBits,
          syncCommitteeSignature: syncAggregate.syncCommitteeSignature,
        }
      : {
          ...attestedData,
          syncCommitteeBits: syncAggregate.syncCommitteeBits,
          syncCommitteeSignature: syncAggregate.syncCommitteeSignature,
        };

    await this.db.bestPartialLightClientUpdate.put(period, newPartialUpdate);
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
  const nextBitCount = sumBits(nextSyncAggregate.syncCommitteeBits);

  // Finalized if participation is over 66%
  if (!prevUpdate.isFinalized && nextSyncAttestedData.isFinalized && nextBitCount * 3 > SYNC_COMMITTEE_SIZE * 2) {
    return true;
  }

  // Higher bit count
  const prevBitCount = sumBits(prevUpdate.syncCommitteeBits);
  if (prevBitCount > nextBitCount) return false;
  if (prevBitCount < nextBitCount) return true;

  // else keep the oldest, lowest chance or re-org and requires less updating
  return prevUpdate.header.slot > nextSyncAttestedData.header.slot;
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

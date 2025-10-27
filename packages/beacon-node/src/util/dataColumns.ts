import {digest} from "@chainsafe/as-sha256";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {ChainForkConfig} from "@lodestar/config";
import {
  ForkAll,
  ForkName,
  ForkPostFulu,
  ForkPreGloas,
  KZG_COMMITMENTS_GINDEX,
  NUMBER_OF_COLUMNS,
} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {
  BeaconBlockBody,
  ColumnIndex,
  CustodyIndex,
  SSZTypesFor,
  SignedBeaconBlock,
  SignedBeaconBlockHeader,
  deneb,
  fulu,
  ssz,
} from "@lodestar/types";
import {bytesToBigInt} from "@lodestar/utils";
import {BlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../chain/blocks/blockInput/types.js";
import {ChainEvent, ChainEventEmitter} from "../chain/emitter.js";
import {Metrics} from "../metrics/metrics.js";
import {NodeId} from "../network/subnets/index.js";
import {dataColumnMatrixRecovery} from "./blobs.js";
import {kzg} from "./kzg.js";

export enum RecoverResult {
  // the recover is not attempted because we have less than `NUMBER_OF_COLUMNS / 2` columns
  NotAttemptedLessThanHalf = "not_attempted_less_than_half",
  // the recover is not attempted because it has full data columns
  NotAttemptedFull = "not_attempted_full",
  // the recover is a success and it helps resolve availability
  SuccessResolved = "success_resolved",
  // the recover is a success but it's late, availability is already resolved by either gossip or getBlobsV2
  SuccessLate = "success_late",
  // the recover failed
  Failed = "failed",
}

export type CustodyConfigOpts = {
  nodeId: NodeId;
  config: ChainForkConfig;
  initialCustodyGroupCount?: number;
};

export class CustodyConfig {
  /**
   * The number of custody groups the node should subscribe to
   */
  targetCustodyGroupCount: number;

  /**
   * The custody columns the node should subscribe to
   */
  custodyColumns: ColumnIndex[];

  /**
   * Custody columns map which column maps to which index in the array of columns custodied
   * with zero representing it is not custodied
   */
  custodyColumnsIndex: Uint8Array;

  /**
   * The number of custody groups the node will sample
   */
  sampledGroupCount: number;

  /**
   * Custody groups sampled by the node as part of custody sampling
   */
  sampleGroups: CustodyIndex[];

  /**
   * Data columns sampled by the node as part of custody sampling
   * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/das-core.md#custody-sampling
   *
   * TODO: Consider race conditions if this updates during sync/backfill
   */
  sampledColumns: ColumnIndex[];

  /**
   * Subnets sampled by the node as part of custody sampling
   */
  sampledSubnets: number[];

  private config: ChainForkConfig;
  private nodeId: NodeId;

  constructor(opts: CustodyConfigOpts) {
    this.config = opts.config;
    this.nodeId = opts.nodeId;
    this.targetCustodyGroupCount = opts.initialCustodyGroupCount ?? this.config.CUSTODY_REQUIREMENT;
    this.custodyColumns = getDataColumns(this.config, this.nodeId, this.targetCustodyGroupCount);
    this.custodyColumnsIndex = this.getCustodyColumnsIndex(this.custodyColumns);
    this.sampledGroupCount = Math.max(this.targetCustodyGroupCount, this.config.SAMPLES_PER_SLOT);
    this.sampleGroups = getCustodyGroups(this.config, this.nodeId, this.sampledGroupCount);
    this.sampledColumns = getDataColumns(this.config, this.nodeId, this.sampledGroupCount);
    this.sampledSubnets = this.sampledColumns.map((columnIndex) =>
      computeSubnetForDataColumn(this.config, columnIndex)
    );
  }

  updateTargetCustodyGroupCount(targetCustodyGroupCount: number) {
    this.targetCustodyGroupCount = targetCustodyGroupCount;
    this.custodyColumns = getDataColumns(this.config, this.nodeId, this.targetCustodyGroupCount);
    this.custodyColumnsIndex = this.getCustodyColumnsIndex(this.custodyColumns);
    // TODO: Porting this over to match current behavior, but I think this incorrectly mixes units:
    // SAMPLES_PER_SLOT is in columns, and CUSTODY_GROUP_COUNT is in groups
    this.sampledGroupCount = Math.max(this.targetCustodyGroupCount, this.config.SAMPLES_PER_SLOT);
    this.sampleGroups = getCustodyGroups(this.config, this.nodeId, this.sampledGroupCount);
    this.sampledColumns = getDataColumns(this.config, this.nodeId, this.sampledGroupCount);
    this.sampledSubnets = this.sampledColumns.map((columnIndex) =>
      computeSubnetForDataColumn(this.config, columnIndex)
    );
  }

  private getCustodyColumnsIndex(custodyColumns: ColumnIndex[]): Uint8Array {
    // custody columns map which column maps to which index in the array of columns custodied
    // with zero representing it is not custodied
    const custodyColumnsIndex = new Uint8Array(NUMBER_OF_COLUMNS);
    let custodyAtIndex = 1;
    for (const columnIndex of custodyColumns) {
      custodyColumnsIndex[columnIndex] = custodyAtIndex;
      custodyAtIndex++;
    }
    return custodyColumnsIndex;
  }
}

function computeSubnetForDataColumn(config: ChainForkConfig, columnIndex: ColumnIndex): number {
  return columnIndex % config.DATA_COLUMN_SIDECAR_SUBNET_COUNT;
}

/**
 * Calculate the number of custody groups the node should subscribe to based on the node's effective balance
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.3/specs/fulu/validator.md#validator-custody
 */
export function getValidatorsCustodyRequirement(config: ChainForkConfig, effectiveBalances: number[]): number {
  if (effectiveBalances.length === 0) {
    return config.CUSTODY_REQUIREMENT;
  }

  const totalNodeEffectiveBalance = effectiveBalances.reduce((total, effectiveBalance) => {
    return total + effectiveBalance;
  }, 0);

  // Must custody one group for every BALANCE_PER_ADDITIONAL_CUSTODY_GROUP of effective balance
  let validatorsCustodyRequirement = Math.floor(
    totalNodeEffectiveBalance / config.BALANCE_PER_ADDITIONAL_CUSTODY_GROUP
  );

  // Any node with at least 1 validator must custody at least VALIDATOR_CUSTODY_REQUIREMENT
  validatorsCustodyRequirement = Math.max(validatorsCustodyRequirement, config.VALIDATOR_CUSTODY_REQUIREMENT);

  // Cannot custody more than NUMBER_OF_CUSTODY_GROUPS
  validatorsCustodyRequirement = Math.min(validatorsCustodyRequirement, config.NUMBER_OF_CUSTODY_GROUPS);

  return validatorsCustodyRequirement;
}

/**
 * Converts a custody group to an array of column indices.  Should be 1-1 as long there are 128
 * columns and 128 custody groups.
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/das-core.md#compute_columns_for_custody_group
 */
export function computeColumnsForCustodyGroup(config: ChainForkConfig, custodyIndex: CustodyIndex): ColumnIndex[] {
  if (custodyIndex >= config.NUMBER_OF_CUSTODY_GROUPS) {
    throw Error(`Invalid custody index ${custodyIndex} >= ${config.NUMBER_OF_CUSTODY_GROUPS}`);
  }
  const columnsPerCustodyGroup = Number(NUMBER_OF_COLUMNS / config.NUMBER_OF_CUSTODY_GROUPS);
  const columnIndexes = [];
  for (let i = 0; i < columnsPerCustodyGroup; i++) {
    columnIndexes.push(config.NUMBER_OF_CUSTODY_GROUPS * i + custodyIndex);
  }
  columnIndexes.sort((a, b) => a - b);
  return columnIndexes;
}

/**
 * Converts nodeId and a the number of custody groups to an array of custody indices. Indexes must be
 * further converted to column indices
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/das-core.md#get_custody_groups
 */
export function getCustodyGroups(config: ChainForkConfig, nodeId: NodeId, custodyGroupCount: number): CustodyIndex[] {
  if (custodyGroupCount > config.NUMBER_OF_CUSTODY_GROUPS) {
    throw Error(`Invalid custody group count ${custodyGroupCount} > ${config.NUMBER_OF_CUSTODY_GROUPS}`);
  }

  // Skip computation if all groups are custodied
  if (custodyGroupCount === config.NUMBER_OF_CUSTODY_GROUPS) {
    return Array.from({length: config.NUMBER_OF_CUSTODY_GROUPS}, (_, i) => i);
  }

  const custodyGroups: CustodyIndex[] = [];
  // nodeId is in bigendian and all computes are in little endian
  let currentId = bytesToBigInt(nodeId, "be");
  while (custodyGroups.length < custodyGroupCount) {
    // could be optimized
    const currentIdBytes = ssz.UintBn256.serialize(currentId);
    const custodyGroup = Number(
      ssz.UintBn64.deserialize(digest(currentIdBytes).slice(0, 8)) % BigInt(config.NUMBER_OF_CUSTODY_GROUPS)
    );

    if (!custodyGroups.includes(custodyGroup)) {
      custodyGroups.push(custodyGroup);
    }

    const willOverflow = currentIdBytes.reduce((acc, elem) => acc && elem === 0xff, true);
    if (willOverflow) {
      currentId = BigInt(0);
    } else {
      currentId++;
    }
  }

  custodyGroups.sort((a, b) => a - b);
  return custodyGroups;
}

export function computePostFuluKzgCommitmentsInclusionProof(
  fork: ForkName,
  body: BeaconBlockBody
): fulu.KzgCommitmentsInclusionProof {
  const bodyView = (ssz[fork].BeaconBlockBody as SSZTypesFor<ForkAll, "BeaconBlockBody">).toView(body);
  return new Tree(bodyView.node).getSingleProof(BigInt(KZG_COMMITMENTS_GINDEX));
}

export function getDataColumns(config: ChainForkConfig, nodeId: NodeId, custodyGroupCount: number): ColumnIndex[] {
  return getCustodyGroups(config, nodeId, custodyGroupCount)
    .flatMap((custodyIndex) => computeColumnsForCustodyGroup(config, custodyIndex))
    .sort((a, b) => a - b);
}

/**
 * Computes the cells for each blob and combines them with cell proofs.
 * Similar to the computeMatrix function described below.
 *
 * SPEC FUNCTION (note: spec currently computes proofs, but we already have them)
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/das-core.md#compute_matrix
 */
export async function getCellsAndProofs(
  blobBundles: fulu.BlobAndProofV2[]
): Promise<{cells: Uint8Array[]; proofs: Uint8Array[]}[]> {
  const blobsAndProofs: {cells: Uint8Array[]; proofs: Uint8Array[]}[] = [];
  for (const {blob, proofs} of blobBundles) {
    const cells = await kzg.asyncComputeCells(blob);
    blobsAndProofs.push({cells, proofs});
  }
  return blobsAndProofs;
}

/**
 * Given a signed block header and the commitments, inclusion proof, cells/proofs associated with
 * each blob in the block, assemble the sidecars which can be distributed to peers.
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/validator.md#get_data_column_sidecars
 */
export function getDataColumnSidecars(
  signedBlockHeader: SignedBeaconBlockHeader,
  kzgCommitments: deneb.KZGCommitment[],
  kzgCommitmentsInclusionProof: fulu.KzgCommitmentsInclusionProof,
  cellsAndKzgProofs: {cells: Uint8Array[]; proofs: Uint8Array[]}[]
): fulu.DataColumnSidecars {
  if (cellsAndKzgProofs.length !== kzgCommitments.length) {
    throw Error("Invalid cellsAndKzgProofs length for getDataColumnSidecars");
  }

  const sidecars: fulu.DataColumnSidecars = [];
  for (let columnIndex = 0; columnIndex < NUMBER_OF_COLUMNS; columnIndex++) {
    const columnCells = [];
    const columnProofs = [];
    for (const {cells, proofs} of cellsAndKzgProofs) {
      columnCells.push(cells[columnIndex]);
      columnProofs.push(proofs[columnIndex]);
    }
    sidecars.push({
      index: columnIndex,
      column: columnCells,
      kzgCommitments,
      kzgProofs: columnProofs,
      signedBlockHeader,
      kzgCommitmentsInclusionProof,
    });
  }
  return sidecars;
}

/**
 * Given a signed block and the cells/proofs associated with each blob in the
 * block, assemble the sidecars which can be distributed to peers.
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/validator.md#get_data_column_sidecars_from_block
 */
export function getDataColumnSidecarsFromBlock(
  config: ChainForkConfig,
  signedBlock: SignedBeaconBlock<ForkPostFulu>,
  cellsAndKzgProofs: {cells: Uint8Array[]; proofs: Uint8Array[]}[]
): fulu.DataColumnSidecars {
  // TODO GLOAS: Need to get blobKzgCommitments from somewhere else
  const blobKzgCommitments = (signedBlock.message.body as BeaconBlockBody<ForkPostFulu & ForkPreGloas>)
    .blobKzgCommitments;

  // No need to create data column sidecars if there are no blobs
  if (blobKzgCommitments.length === 0) {
    return [];
  }

  const fork = config.getForkName(signedBlock.message.slot);
  const signedBlockHeader = signedBlockToSignedHeader(config, signedBlock);

  const kzgCommitmentsInclusionProof = computePostFuluKzgCommitmentsInclusionProof(fork, signedBlock.message.body);

  return getDataColumnSidecars(signedBlockHeader, blobKzgCommitments, kzgCommitmentsInclusionProof, cellsAndKzgProofs);
}

/**
 * Given a DataColumnSidecar and the cells/proofs associated with each blob corresponding
 * to the commitments it contains, assemble all sidecars for distribution to peers.
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/validator.md#get_data_column_sidecars_from_column_sidecar
 */
export function getDataColumnSidecarsFromColumnSidecar(
  sidecar: fulu.DataColumnSidecar,
  cellsAndKzgProofs: {cells: Uint8Array[]; proofs: Uint8Array[]}[]
): fulu.DataColumnSidecars {
  return getDataColumnSidecars(
    sidecar.signedBlockHeader,
    sidecar.kzgCommitments,
    sidecar.kzgCommitmentsInclusionProof,
    cellsAndKzgProofs
  );
}

/**
 * If we receive more than half of NUMBER_OF_COLUMNS (64) we should recover all remaining columns
 */
export async function recoverDataColumnSidecars(
  blockInput: BlockInputColumns,
  emitter: ChainEventEmitter,
  metrics: Metrics | null
): Promise<DataColumnReconstructionCode> {
  const existingColumns = blockInput.getAllColumns();
  const columnCount = existingColumns.length;
  if (columnCount >= NUMBER_OF_COLUMNS) {
    // We have all columns
    return DataColumnReconstructionCode.NotAttemptedAlreadyFull;
  }

  if (columnCount < NUMBER_OF_COLUMNS / 2) {
    // We don't have enough columns to recover
    return DataColumnReconstructionCode.NotAttemptedHaveLessThanHalf;
  }

  metrics?.recoverDataColumnSidecars.custodyBeforeReconstruction.set(columnCount);
  const partialSidecars = new Map<number, fulu.DataColumnSidecar>();
  for (const columnSidecar of existingColumns) {
    // the more columns we put, the slower the recover
    if (partialSidecars.size >= NUMBER_OF_COLUMNS / 2) {
      break;
    }
    partialSidecars.set(columnSidecar.index, columnSidecar);
  }

  const timer = metrics?.recoverDataColumnSidecars.recoverTime.startTimer();
  // if this function throws, we catch at the consumer side
  const fullSidecars = await dataColumnMatrixRecovery(partialSidecars).catch(() => null);
  timer?.();
  if (fullSidecars == null) {
    return DataColumnReconstructionCode.NullReturned;
  }

  if (blockInput.getAllColumns().length === NUMBER_OF_COLUMNS) {
    // either gossip or getBlobsV2 resolved availability while we were recovering
    return DataColumnReconstructionCode.SuccessLate;
  }

  // Once the node obtains a column through reconstruction,
  // the node MUST expose the new column as if it had received it over the network.
  // If the node is subscribed to the subnet corresponding to the column,
  // it MUST send the reconstructed DataColumnSidecar to its topic mesh neighbors.
  // If instead the node is not subscribed to the corresponding subnet,
  // it SHOULD still expose the availability of the DataColumnSidecar as part of the gossip emission process.
  // After exposing the reconstructed DataColumnSidecar to the network,
  // the node MAY delete the DataColumnSidecar if it is not part of the node's custody requirement.
  const sidecarsToPublish = [];
  for (const columnSidecar of fullSidecars) {
    if (!blockInput.hasColumn(columnSidecar.index)) {
      blockInput.addColumn({
        blockRootHex: blockInput.blockRootHex,
        columnSidecar,
        seenTimestampSec: Date.now() / 1000,
        source: BlockInputSource.recovery,
      });
      sidecarsToPublish.push(columnSidecar);
    }
  }
  emitter.emit(ChainEvent.publishDataColumns, sidecarsToPublish);

  return DataColumnReconstructionCode.SuccessResolved;
}

export enum DataColumnReconstructionCode {
  NotAttemptedAlreadyFull = "not_attempted_full",
  NotAttemptedHaveLessThanHalf = "not_attempted_less_than_half",
  NullReturned = "null_returned",
  SuccessLate = "success_late",
  SuccessResolved = "success_resolved",
  Failed = "failed",
}

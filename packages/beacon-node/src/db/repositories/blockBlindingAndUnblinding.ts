import {BYTES_PER_LOGS_BLOOM, ForkSeq, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {allForks, bellatrix, capella, ssz} from "@lodestar/types";
import {VARIABLE_FIELD_OFFSET, ROOT_SIZE} from "../../util/sszBytes.js";

// offsets are little endian so "first" byte is byte 3 (0-indexed)
const BLINDED_BYTE_LOCATION = 3;
const DATABASE_SERIALIZED_FULL_BLOCK_BYTE = 0x00;
const DATABASE_SERIALIZED_BLINDED_BLOCK_BYTE = 0x01;

export function isFullBlock(block: allForks.FullOrBlindedSignedBeaconBlock): boolean {
  return (block as bellatrix.SignedBeaconBlock).message.body.executionPayload !== undefined;
}

export function isSerializedBlinded(maybeBlind: Uint8Array): boolean {
  return maybeBlind[BLINDED_BYTE_LOCATION] === DATABASE_SERIALIZED_BLINDED_BLOCK_BYTE;
}

export function setBlindedByte(block: Uint8Array): void {
  block[BLINDED_BYTE_LOCATION] = DATABASE_SERIALIZED_BLINDED_BLOCK_BYTE;
}

export function unsetBlindedByte(data: Uint8Array): void {
  data[BLINDED_BYTE_LOCATION] = DATABASE_SERIALIZED_FULL_BLOCK_BYTE;
}

export function maybeUnsetBlindByte(maybeBlind: Uint8Array): Uint8Array {
  if (isSerializedBlinded(maybeBlind)) {
    unsetBlindedByte(maybeBlind);
  }
  return maybeBlind;
}

interface TransactionAndWithdrawalRoots {
  transactionRoot?: Uint8Array;
  withdrawalsRoot?: Uint8Array;
}
export function calculateRoots(
  forkSeq: ForkSeq,
  block: allForks.FullOrBlindedSignedBeaconBlock
): TransactionAndWithdrawalRoots {
  const roots: TransactionAndWithdrawalRoots = {};
  if (forkSeq >= ForkSeq.bellatrix) {
    roots.transactionRoot = ssz.bellatrix.Transactions.hashTreeRoot(
      (block as bellatrix.SignedBeaconBlock).message.body.executionPayload.transactions
    );
  }
  if (forkSeq >= ForkSeq.capella) {
    roots.withdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(
      (block as capella.SignedBeaconBlock).message.body.executionPayload.withdrawals
    );
  }
  return roots;
}

export function buildVariableOffset(value: number): Uint8Array {
  const offset = new Uint8Array(VARIABLE_FIELD_OFFSET);
  new DataView(offset.buffer).setUint32(0, value, true);
  return offset;
}

// private async fullBlockFromMaybeBlinded(
//   maybeBlinded: allForks.FullOrBlindedSignedBeaconBlock
// ): Promise<allForks.FullOrBlindedSignedBeaconBlock> {
//   if (!isBlindedSignedBeaconBlock(maybeBlinded)) {
//     return maybeBlinded;
//   }
//   if (!this.executionEngine) {
//     throw new Error("Execution engine not set");
//   }
//   const elBlockHash = (maybeBlinded as bellatrix.SignedBlindedBeaconBlock).message.body.executionPayloadHeader
//     .blockHash;
//   const engineRes = await this.executionEngine.getPayloadBodiesByHash([elBlockHash.toString()]);
//   if (!engineRes[0]) {
//     throw new Error(`Execution payload not found for slot ${maybeBlinded.message.slot}`);
//   }

//   const a = ssz[this.config.getForkName(value.message.slot)].SignedBeaconBlock.clone(value);
//   a.message.body.executionPayload = engineRes[0];
//   // (value as bellatrix.SignedBeaconBlock).message.body.executionPayload = engineRes[0];

//   blinded.message.body.executionPayload = elPayload;
//   return blinded;
// }

/**
 *  * class SignedBeaconBlock(Container):
 *   message: BeaconBlock [offset - 4 bytes]
 *   signature: BLSSignature [fixed - 96 bytes]
 *
 * class BeaconBlock(Container) or class BlindedBeaconBlock(Container):
 *   slot: Slot                      [fixed - 8 bytes]
 *   proposer_index: ValidatorIndex  [fixed - 8 bytes]
 *   parent_root: Root               [fixed - 32 bytes]
 *   state_root: Root                [fixed - 32 bytes]
 *   body: MaybeBlindBeaconBlockBody [offset - 4 bytes]
 *
 *
 * class BeaconBlockBody(Container) or class BlindedBeaconBlockBody(Container):
 *
 * Phase 0:
 *   randaoReveal:                  [fixed -  96 bytes]
 *   eth1Data: [Container]
 *     depositRoot:                 [fixed -  32 bytes]
 *     depositCount:                [fixed -   8 bytes]
 *     blockHash:                   [fixed -  32 bytes]
 *   graffiti:                      [fixed -  32 bytes]
 *   proposerSlashings:             [offset -  4 bytes]
 *   attesterSlashings:             [offset -  4 bytes]
 *   attestations:                  [offset -  4 bytes]
 *   deposits:                      [offset -  4 bytes]
 *   voluntaryExits:                [offset -  4 bytes]
 *
 * Altair:
 *   syncCommitteeBits:             [fixed -  4 or 64 bytes] (pull from params)
 *   syncCommitteeSignature:        [fixed -  96 bytes]
 *
 * Bellatrix:
 *   executionPayload:              [offset -  4 bytes]
 *
 * Capella:
 *   blsToExecutionChanges          [offset -  4 bytes]
 *
 * Deneb:
 *   blobKzgCommitments             [offset -  4 bytes]
 */
const EXECUTION_PAYLOAD_FIXED_OFFSET =
  4 + 96 + 8 + 8 + 32 + 32 + 4 + 96 + 32 + 8 + 32 + 32 + 4 + 4 + 4 + 4 + 4 + SYNC_COMMITTEE_SIZE / 8 + 96;

const BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET = EXECUTION_PAYLOAD_FIXED_OFFSET + VARIABLE_FIELD_OFFSET;

const BLOB_KZG_COMMITMENTS_FIXED_OFFSET = BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET + VARIABLE_FIELD_OFFSET;

/**
 * class ExecutionPayload(Container) or class ExecutionPayloadHeader(Container)
 *     parentHash:                  [fixed -  32 bytes]
 *     feeRecipient:                [fixed -  20 bytes]
 *     stateRoot:                   [fixed -  32 bytes]
 *     receiptsRoot:                [fixed -  32 bytes]
 *     logsBloom:                   [fixed - 256 bytes] (pull from params)
 *     prevRandao:                  [fixed -  32 bytes]
 *     blockNumber:                 [fixed -   8 bytes]
 *     gasLimit:                    [fixed -   8 bytes]
 *     gasUsed:                     [fixed -   8 bytes]
 *     timestamp:                   [fixed -   8 bytes]
 *     extraData:                   [offset -  4 bytes]
 *     baseFeePerGas:               [fixed -  32 bytes]
 *     blockHash:                   [fixed -  32 bytes]
 *     ------------------------------------------------
 *     transactions:                [offset -  4 bytes]
 *     - or -
 *     transactionsRoot:            [fixed -  32 bytes]
 *
 * Capella:
 *     withdrawals:                 [offset -  4 bytes]
 *     - or -
 *     withdrawalsRoot:             [fixed -  32 bytes]
 *     ------------------------------------------------
 * Deneb:
 *     dataGasUsed:                 [fixed -   8 bytes]
 *     excessDataGas:               [fixed -   8 bytes]
 */
const EXTRA_DATA_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD =
  32 + 20 + 32 + 32 + BYTES_PER_LOGS_BLOOM + 32 + 8 + 8 + 8 + 8;
const TRANSACTIONS_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD =
  EXTRA_DATA_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD + 4 + 32 + 32;

/**
 * Convert serialized SignedBeaconBlock to SignedBlindedBeaconBlock
 *
 * @param {ForkSeq} forkSeq - fork sequence
 * @param {Uint8Array} block - serialized SignedBeaconBlock
 * @param {Uint8Array} transactionsRoot - transactions root
 * @param {Uint8Array} withdrawalsRoot - withdrawals root
 *
 * @returns {Uint8Array} - serialized SignedBlindedBeaconBlock
 */
export function fullToBlindedSignedBeaconBlock(
  forkSeq: ForkSeq,
  block: Uint8Array,
  transactionsRoot?: Uint8Array,
  withdrawalsRoot?: Uint8Array
): Uint8Array {
  /**
   * Phase0:
   *   return same data
   * Altair:
   *   return same data
   */
  if (forkSeq === ForkSeq.phase0 || forkSeq === ForkSeq.altair) {
    return block;
  }

  // fields that are common to forks after Bellatrix
  if (!transactionsRoot) {
    throw new Error("must supply transactionsRoot");
  }

  // take apart the block to get the offsets
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const executionPayloadOffset = dv.getUint32(EXECUTION_PAYLOAD_FIXED_OFFSET, true);
  const extraDataFixedOffset = executionPayloadOffset + EXTRA_DATA_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD;
  let extraDataVariableOffset = dv.getUint32(extraDataFixedOffset, true);
  const transactionsFixedOffset = executionPayloadOffset + TRANSACTIONS_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD;
  const transactionsVariableOffset = dv.getUint32(transactionsFixedOffset, true);

  // data for reassembly
  const preamble = Uint8Array.prototype.slice.call(block, 0, transactionsFixedOffset);
  const preambleDataView = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
  const extraData = Uint8Array.prototype.slice.call(block, extraDataVariableOffset, transactionsVariableOffset);

  /**
   * Bellatrix:
   *   preamble: Fixed Length Data
   *   transactions: Variable Offset
   *   extraData: Variable Length Data
   *   transactions: Variable Length Data
   *   - to -
   *   preamble: Fixed Length Data
   *   transactionsRoot: Root
   *   extraData: Variable Length Data
   */
  if (forkSeq === ForkSeq.bellatrix) {
    // update variable offsets
    preambleDataView.setUint32(extraDataFixedOffset, transactionsFixedOffset + ROOT_SIZE, true);
    // build new data
    return Uint8Array.of(...preamble, ...transactionsRoot, ...extraData);
  }

  // fields that are common to forks after Capella
  if (!withdrawalsRoot) {
    throw new Error("must supply withdrawalsRoot");
  }
  let blsToExecutionChangeVariableOffset = dv.getUint32(BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET, true);
  const blsChangeAndMaybeCommitmentsData = Uint8Array.prototype.slice.call(block, blsToExecutionChangeVariableOffset);

  /**
   * Capella:
   *   preamble: Fixed Length Data
   *   transactions: Variable Offset
   *   withdrawals: Variable Offset
   *   extraData: Variable Length Data
   *   transactions: Variable Length Data
   *   withdrawals: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   *   - to -
   *   transactionsRoot: Root
   *   withdrawalsRoot: Root
   *   extraData: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   */
  if (forkSeq === ForkSeq.capella) {
    // build variable offsets
    extraDataVariableOffset = transactionsFixedOffset + 2 * ROOT_SIZE;
    blsToExecutionChangeVariableOffset = extraDataVariableOffset + extraData.length;
    // update variable offsets
    preambleDataView.setUint32(extraDataFixedOffset, extraDataVariableOffset, true);
    preambleDataView.setUint32(BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET, blsToExecutionChangeVariableOffset, true);
    // build new data
    return Uint8Array.of(
      ...preamble,
      ...transactionsRoot,
      ...withdrawalsRoot,
      ...extraData,
      ...blsChangeAndMaybeCommitmentsData
    );
  }

  // fields that are common to forks after Deneb
  const startDataGasUsed = transactionsFixedOffset + 2 * VARIABLE_FIELD_OFFSET;
  const dataGasUsedAndExcessDataGas = Uint8Array.prototype.slice.call(
    block,
    startDataGasUsed,
    startDataGasUsed + 2 * 8
  );

  let blobCommitmentsVariableOffset = dv.getUint32(BLOB_KZG_COMMITMENTS_FIXED_OFFSET, true);
  const blsToExecutionChangeLength = blobCommitmentsVariableOffset - blsToExecutionChangeVariableOffset;
  /**
   * Deneb:
   *   transactions: Variable Offset
   *   withdrawals: Variable Offset
   *   dataGasUsed: UintBn64
   *   excessDataGas: UintBn64
   *   extraData: Variable Length Data
   *   transactions: Variable Length Data
   *   withdrawals: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   *   blobKzgCommitments: Variable Length Data
   *   - to -
   *   transactionsRoot: Root
   *   withdrawalsRoot: Root
   *   dataGasUsed: UintBn64
   *   excessDataGas: UintBn64
   *   extraData: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   *   blobKzgCommitments: Variable Length Data
   */
  if (forkSeq === ForkSeq.deneb) {
    // build variable offsets
    extraDataVariableOffset = transactionsFixedOffset + 2 * (ROOT_SIZE + 8);
    blsToExecutionChangeVariableOffset = extraDataVariableOffset + extraData.length;
    blobCommitmentsVariableOffset = blsToExecutionChangeVariableOffset + blsToExecutionChangeLength;
    // update variable offsets
    preambleDataView.setUint32(extraDataFixedOffset, extraDataVariableOffset, true);
    preambleDataView.setUint32(BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET, blsToExecutionChangeVariableOffset, true);
    preambleDataView.setUint32(BLOB_KZG_COMMITMENTS_FIXED_OFFSET, blobCommitmentsVariableOffset, true);
    // build new data
    return Uint8Array.of(
      ...preamble,
      ...transactionsRoot,
      ...withdrawalsRoot,
      ...dataGasUsedAndExcessDataGas,
      ...extraData,
      ...blsChangeAndMaybeCommitmentsData
    );
  }

  throw new Error("unknown forkSeq, cannot un-blind");
}

/**
 * Convert serialized SignedBlindedBeaconBlock to SignedBeaconBlock
 */
export function blindedToFullSignedBeaconBlock(
  forkSeq: ForkSeq,
  block: Uint8Array,
  transactions?: Uint8Array,
  withdrawals?: Uint8Array
): Uint8Array {
  /**
   * Phase0:
   *   return same data
   * Altair:
   *   return same data
   */
  if (forkSeq === ForkSeq.phase0 || forkSeq === ForkSeq.altair) {
    return block;
  }

  // fields that are common to forks after Bellatrix
  if (!transactions) {
    throw new Error("must supply transaction");
  }

  // take apart the block to get the offsets
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const executionPayloadOffset = dv.getUint32(EXECUTION_PAYLOAD_FIXED_OFFSET, true);
  const extraDataFixedOffset = executionPayloadOffset + EXTRA_DATA_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD;
  let extraDataVariableOffset = dv.getUint32(extraDataFixedOffset, true);
  const transactionsFixedOffset = executionPayloadOffset + TRANSACTIONS_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD;

  // data for reassembly
  const preamble = Uint8Array.prototype.slice.call(block, 0, transactionsFixedOffset);
  const preambleDataView = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);

  /**
   * Bellatrix:
   *   preamble: Fixed Length Data
   *   transactionsRoot: Root
   *   extraData: Variable Length Data
   *   - to -
   *   preamble: Fixed Length Data
   *   transactions: Variable Offset
   *   extraData: Variable Length Data
   *   transactions: Variable Length Data
   */
  if (forkSeq === ForkSeq.bellatrix) {
    // data for reassembly
    const extraData = Uint8Array.prototype.slice.call(block, extraDataVariableOffset);

    // update variable offsets
    extraDataVariableOffset = transactionsFixedOffset + VARIABLE_FIELD_OFFSET;
    preambleDataView.setUint32(extraDataFixedOffset, extraDataVariableOffset, true);

    // build new data
    return Uint8Array.from([
      ...preamble,
      ...buildVariableOffset(extraDataVariableOffset + extraData.length),
      ...extraData,
      ...transactions,
    ]);
  }

  // fields that are common to forks after Capella
  if (!withdrawals) {
    throw new Error("must supply withdrawals");
  }

  // data for reassembly
  let blsToExecutionChangeVariableOffset = dv.getUint32(BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET, true);
  const extraData = Uint8Array.prototype.slice.call(block, extraDataVariableOffset, blsToExecutionChangeVariableOffset);
  const blsChangeAndMaybeCommitmentsData = Uint8Array.prototype.slice.call(block, blsToExecutionChangeVariableOffset);

  /**
   * Capella:
   *   preamble: Fixed Length Data
   *   transactionsRoot: Root
   *   withdrawalsRoot: Root
   *   extraData: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   *   - to -
   *   preamble: Fixed Length Data
   *   transactions: Variable Offset
   *   withdrawals: Variable Offset
   *   extraData: Variable Length Data
   *   transactions: Variable Length Data
   *   withdrawals: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   */
  if (forkSeq === ForkSeq.capella) {
    // update variable offsets
    extraDataVariableOffset = transactionsFixedOffset + 2 * VARIABLE_FIELD_OFFSET;
    const transactionsVariableOffset = extraDataVariableOffset + extraData.length;
    const withdrawalsVariableOffset = transactionsVariableOffset + transactions.length;
    blsToExecutionChangeVariableOffset = withdrawalsVariableOffset + withdrawals.length;

    // update variable offsets
    preambleDataView.setUint32(extraDataFixedOffset, extraDataVariableOffset, true);
    preambleDataView.setUint32(BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET, blsToExecutionChangeVariableOffset, true);

    // build new data
    return Uint8Array.of(
      ...preamble,
      ...buildVariableOffset(transactionsVariableOffset),
      ...buildVariableOffset(withdrawalsVariableOffset),
      ...extraData,
      ...transactions,
      ...withdrawals,
      ...blsChangeAndMaybeCommitmentsData
    );
  }

  // post Capella data for reassembly

  // have the blob data prepped already but need bls_change length to calculate new blob offset
  const blsToExecutionChangeLength =
    dv.getUint32(BLOB_KZG_COMMITMENTS_FIXED_OFFSET, true) - blsToExecutionChangeVariableOffset;

  // get dataGasUsedAndExcessDataGas
  const startDataGasUsed = transactionsFixedOffset + 2 * ROOT_SIZE;
  const dataGasUsedAndExcessDataGas = Uint8Array.prototype.slice.call(
    block,
    startDataGasUsed,
    startDataGasUsed + 2 * 8
  );
  /**
   * Deneb:
   *   preamble: Fixed Length Data
   *   transactionsRoot: Root
   *   withdrawalsRoot: Root
   *   dataGasUsed: UintBn64
   *   excessDataGas: UintBn64
   *   extraData: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   *   blobKzgCommitments: Variable Length Data
   *   - to -
   *   preamble: Fixed Length Data
   *   transactions: Variable Offset
   *   withdrawals: Variable Offset
   *   dataGasUsed: UintBn64
   *   excessDataGas: UintBn64
   *   extraData: Variable Length Data
   *   transactions: Variable Length Data
   *   withdrawals: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   *   blobKzgCommitments: Variable Length Data
   */
  if (forkSeq === ForkSeq.deneb) {
    // update variable offsets
    extraDataVariableOffset = transactionsFixedOffset + 2 * VARIABLE_FIELD_OFFSET + 2 * 8;
    const transactionsVariableOffset = extraDataVariableOffset + extraData.length;
    const withdrawalsVariableOffset = transactionsVariableOffset + transactions.length;
    blsToExecutionChangeVariableOffset = withdrawalsVariableOffset + withdrawals.length;
    const blobCommitmentsVariableOffset = blsToExecutionChangeVariableOffset + blsToExecutionChangeLength;

    // update variable offsets
    preambleDataView.setUint32(extraDataFixedOffset, extraDataVariableOffset, true);
    preambleDataView.setUint32(BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET, blsToExecutionChangeVariableOffset, true);
    preambleDataView.setUint32(BLOB_KZG_COMMITMENTS_FIXED_OFFSET, blobCommitmentsVariableOffset, true);

    // build new data
    return Uint8Array.of(
      ...preamble,
      ...buildVariableOffset(transactionsVariableOffset),
      ...buildVariableOffset(withdrawalsVariableOffset),
      ...dataGasUsedAndExcessDataGas,
      ...extraData,
      ...transactions,
      ...withdrawals,
      ...blsChangeAndMaybeCommitmentsData
    );
  }

  throw new Error("unknown forkSeq, cannot un-blind");
}

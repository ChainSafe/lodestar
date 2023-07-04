import {BYTES_PER_LOGS_BLOOM, ForkSeq, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {VARIABLE_FIELD_OFFSET, ROOT_SIZE} from "../../util/sszBytes.js";

// offsets are little endian so "first" byte is byte 3
const BLINDED_BYTE_LOCATION = 3;
const DATABASE_SERIALIZED_FULL_BLOCK_BYTE = 0x00;
const DATABASE_SERIALIZED_BLINDED_BLOCK_BYTE = 0x01;

export function isSerializedBlinded(maybeBlind: Uint8Array): boolean {
  return maybeBlind[BLINDED_BYTE_LOCATION] === DATABASE_SERIALIZED_BLINDED_BLOCK_BYTE;
}

export function setBlindedByte(block: Uint8Array): void {
  block[BLINDED_BYTE_LOCATION] = DATABASE_SERIALIZED_BLINDED_BLOCK_BYTE;
}

export function unsetBlindedByte(block: Uint8Array): void {
  block[BLINDED_BYTE_LOCATION] = DATABASE_SERIALIZED_FULL_BLOCK_BYTE;
}

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
const EXECUTION_PAYLOAD_FIXED_OFFSET_OF_VARIABLE_OFFSET =
  4 + 96 + 8 + 8 + 32 + 32 + 4 + 96 + 32 + 8 + 32 + 32 + 4 + 4 + 4 + 4 + 4 + SYNC_COMMITTEE_SIZE / 8 + 96;

const BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET_OF_VARIABLE_OFFSET =
  EXECUTION_PAYLOAD_FIXED_OFFSET_OF_VARIABLE_OFFSET + VARIABLE_FIELD_OFFSET;

const BLOB_KZG_COMMITMENTS_FIXED_OFFSET_OF_VARIABLE_OFFSET =
  BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET_OF_VARIABLE_OFFSET + VARIABLE_FIELD_OFFSET;

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
 * Transform number variable offset to little endian Uint8Array
 *
 * @param {number} offset - variable offset
 * @returns {Uint8Array} - Little endian variable offset
 */
function buildVariableOffset(offset: number): Uint8Array {
  const newOffset = new Uint8Array(VARIABLE_FIELD_OFFSET);
  for (let i = 0; i < VARIABLE_FIELD_OFFSET; i++) {
    newOffset[i] = offset % 256;
    offset = Math.floor(offset / 256);
  }
  return newOffset.reverse();
}

/**
 * Updates the variable offset in-place for serialized data. Calcs newOffset and
 * reverses it so its little endian. Then updates the data with the new offset
 *
 * @param data - serialized data
 * @param fixedOffset - fixed offset of the variable offset
 * @param variableOffset - new variable offset
 */
function updateVariableOffset(data: Uint8Array, fixedOffset: number, variableOffset: number): void {
  const newOffset = buildVariableOffset(variableOffset);
  for (let i = 0; i < VARIABLE_FIELD_OFFSET; i++) {
    data[i + fixedOffset] = newOffset[i];
  }
}

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
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const executionPayloadOffset = dv.getUint32(EXECUTION_PAYLOAD_FIXED_OFFSET_OF_VARIABLE_OFFSET, true);
  const extraDataFixedOffset = executionPayloadOffset + EXTRA_DATA_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD;
  let extraDataVariableOffset = dv.getUint32(extraDataFixedOffset, true);
  const transactionsFixedOffset = executionPayloadOffset + TRANSACTIONS_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD;
  const transactionsVariableOffset = dv.getUint32(transactionsFixedOffset, true);
  const dataBefore = Uint8Array.prototype.slice.call(block, 0, transactionsFixedOffset);
  const extraData = Uint8Array.prototype.slice.call(block, extraDataVariableOffset, transactionsVariableOffset);

  /**
   * Bellatrix:
   *   transactions: Variable Offset
   *   extraData: Variable Length Data
   *   transactions: Variable Length Data
   *   - to -
   *   transactionsRoot: Root
   *   extraData: Variable Length Data
   */
  if (forkSeq === ForkSeq.bellatrix) {
    // update variable offsets
    extraDataVariableOffset = transactionsFixedOffset + ROOT_SIZE;
    updateVariableOffset(dataBefore, extraDataFixedOffset, extraDataVariableOffset);
    // build new data
    return Uint8Array.from([...dataBefore, ...transactionsRoot, ...extraData]);
  }

  // fields that are common to forks after Capella
  if (!withdrawalsRoot) {
    throw new Error("must supply withdrawalsRoot");
  }
  let blsToExecutionChangeVariableOffset = dv.getUint32(BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET_OF_VARIABLE_OFFSET, true);
  const blsChangeAndMaybeCommitmentsData = Uint8Array.prototype.slice.call(block, blsToExecutionChangeVariableOffset);

  /**
   * Capella:
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
    updateVariableOffset(dataBefore, extraDataFixedOffset, extraDataVariableOffset);
    updateVariableOffset(
      dataBefore,
      BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET_OF_VARIABLE_OFFSET,
      blsToExecutionChangeVariableOffset
    );
    // build new data
    return Uint8Array.from([
      ...dataBefore,
      ...transactionsRoot,
      ...withdrawalsRoot,
      ...extraData,
      ...blsChangeAndMaybeCommitmentsData,
    ]);
  }

  // fields that are common to forks after Deneb
  const startDataGasUsed = transactionsFixedOffset + 2 * VARIABLE_FIELD_OFFSET;
  const dataGasUsedAndExcessDataGas = Uint8Array.prototype.slice.call(
    block,
    startDataGasUsed,
    startDataGasUsed + 2 * 8
  );

  let blobCommitmentsVariableOffset = dv.getUint32(BLOB_KZG_COMMITMENTS_FIXED_OFFSET_OF_VARIABLE_OFFSET, true);
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
    updateVariableOffset(dataBefore, extraDataFixedOffset, extraDataVariableOffset);
    updateVariableOffset(
      dataBefore,
      BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET_OF_VARIABLE_OFFSET,
      blsToExecutionChangeVariableOffset
    );
    updateVariableOffset(
      dataBefore,
      BLOB_KZG_COMMITMENTS_FIXED_OFFSET_OF_VARIABLE_OFFSET,
      blobCommitmentsVariableOffset
    );
    // build new data
    return Uint8Array.from([
      ...dataBefore,
      ...transactionsRoot,
      ...withdrawalsRoot,
      ...dataGasUsedAndExcessDataGas,
      ...extraData,
      ...blsChangeAndMaybeCommitmentsData,
    ]);
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
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const executionPayloadOffset = dv.getUint32(EXECUTION_PAYLOAD_FIXED_OFFSET_OF_VARIABLE_OFFSET, true);
  const extraDataFixedOffset = executionPayloadOffset + EXTRA_DATA_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD;
  let extraDataVariableOffset = dv.getUint32(extraDataFixedOffset, true);
  const transactionsFixedOffset = executionPayloadOffset + TRANSACTIONS_FIXED_OFFSET_FROM_START_EXECUTION_PAYLOAD;
  const dataBefore = Uint8Array.prototype.slice.call(block, 0, transactionsFixedOffset);

  /**
   * Bellatrix:
   *   transactionsRoot: Root
   *   extraData: Variable Length Data
   *   - to -
   *   transactions: Variable Offset
   *   extraData: Variable Length Data
   *   transactions: Variable Length Data
   */
  if (forkSeq === ForkSeq.bellatrix) {
    const extraData = Uint8Array.prototype.slice.call(block, extraDataVariableOffset);
    // update variable offsets
    extraDataVariableOffset = transactionsFixedOffset + VARIABLE_FIELD_OFFSET;
    updateVariableOffset(dataBefore, extraDataFixedOffset, extraDataVariableOffset);
    const transactionsVariableOffset = extraDataVariableOffset + extraData.length;
    // build new data
    return Uint8Array.from([
      ...dataBefore,
      ...buildVariableOffset(transactionsVariableOffset),
      ...transactions,
      ...extraData,
    ]);
  }

  // fields that are common to forks after Capella
  if (!withdrawals) {
    throw new Error("must supply withdrawals");
  }
  let blsToExecutionChangeVariableOffset = dv.getUint32(BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET_OF_VARIABLE_OFFSET, true);
  const extraData = Uint8Array.prototype.slice.call(block, extraDataVariableOffset, blsToExecutionChangeVariableOffset);
  const blsChangeAndMaybeCommitmentsData = Uint8Array.prototype.slice.call(block, blsToExecutionChangeVariableOffset);

  /**
   * Capella:
   *   transactionsRoot: Root
   *   withdrawalsRoot: Root
   *   extraData: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   *   - to -
   *   transactions: Variable Offset
   *   withdrawals: Variable Offset
   *   extraData: Variable Length Data
   *   transactions: Variable Length Data
   *   withdrawals: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   */
  if (forkSeq === ForkSeq.capella) {
    // build variable offsets
    extraDataVariableOffset = transactionsFixedOffset + 2 * VARIABLE_FIELD_OFFSET;
    const transactionsVariableOffset = extraDataVariableOffset + extraData.length;
    const withdrawalsVariableOffset = transactionsVariableOffset + transactions.length;
    blsToExecutionChangeVariableOffset = withdrawalsVariableOffset + withdrawals.length;
    // update variable offsets
    updateVariableOffset(dataBefore, extraDataFixedOffset, extraDataVariableOffset);
    updateVariableOffset(
      dataBefore,
      BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET_OF_VARIABLE_OFFSET,
      blsToExecutionChangeVariableOffset
    );
    // build new data
    return Uint8Array.from([
      ...dataBefore,
      ...buildVariableOffset(transactionsVariableOffset),
      ...buildVariableOffset(withdrawalsVariableOffset),
      ...extraData,
      ...transactions,
      ...withdrawals,
      ...blsChangeAndMaybeCommitmentsData,
    ]);
  }

  // fields that are common to forks after Deneb
  let blobCommitmentsVariableOffset = dv.getUint32(BLOB_KZG_COMMITMENTS_FIXED_OFFSET_OF_VARIABLE_OFFSET, true);
  const blsToExecutionChangeLength = blobCommitmentsVariableOffset - blsToExecutionChangeVariableOffset;
  const startDataGasUsed = transactionsFixedOffset + 2 * ROOT_SIZE;
  const dataGasUsedAndExcessDataGas = Uint8Array.prototype.slice.call(
    block,
    startDataGasUsed,
    startDataGasUsed + 2 * 8
  );
  /**
   * Deneb:
   *   transactionsRoot: Root
   *   withdrawalsRoot: Root
   *   dataGasUsed: UintBn64
   *   excessDataGas: UintBn64
   *   extraData: Variable Length Data
   *   blsToExecutionChanges: Variable Length Data
   *   blobKzgCommitments: Variable Length Data
   *   - to -
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
    // build variable offsets
    extraDataVariableOffset = transactionsFixedOffset + 2 * (VARIABLE_FIELD_OFFSET + 8);
    const transactionsVariableOffset = extraDataVariableOffset + extraData.length;
    const withdrawalsVariableOffset = transactionsVariableOffset + transactions.length;
    blsToExecutionChangeVariableOffset = withdrawalsVariableOffset + withdrawals.length;
    blobCommitmentsVariableOffset = blsToExecutionChangeVariableOffset + blsToExecutionChangeLength;
    // update variable offsets
    updateVariableOffset(dataBefore, extraDataFixedOffset, extraDataVariableOffset);
    updateVariableOffset(
      dataBefore,
      BLS_TO_EXECUTION_CHANGE_FIXED_OFFSET_OF_VARIABLE_OFFSET,
      blsToExecutionChangeVariableOffset
    );
    updateVariableOffset(
      dataBefore,
      BLOB_KZG_COMMITMENTS_FIXED_OFFSET_OF_VARIABLE_OFFSET,
      blobCommitmentsVariableOffset
    );
    // build new data
    return Uint8Array.from([
      ...dataBefore,
      ...buildVariableOffset(transactionsVariableOffset),
      ...buildVariableOffset(withdrawalsVariableOffset),
      ...dataGasUsedAndExcessDataGas,
      ...extraData,
      ...transactions,
      ...withdrawals,
      ...blsChangeAndMaybeCommitmentsData,
    ]);
  }

  throw new Error("unknown forkSeq, cannot un-blind");
}

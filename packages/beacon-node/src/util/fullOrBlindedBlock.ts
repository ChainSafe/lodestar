import {ChainForkConfig} from "@lodestar/config";
import {ssz, allForks, bellatrix, capella} from "@lodestar/types";
import {BYTES_PER_LOGS_BLOOM, ForkSeq, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {executionPayloadToPayloadHeader} from "@lodestar/state-transition";
import {ROOT_SIZE, VARIABLE_FIELD_OFFSET, getSlotFromSignedBeaconBlockSerialized} from "./sszBytes.js";

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
const LOCATION_OF_EXECUTION_PAYLOAD_OFFSET =
  4 + 96 + 8 + 8 + 32 + 32 + 4 + 96 + 32 + 8 + 32 + 32 + 4 + 4 + 4 + 4 + 4 + SYNC_COMMITTEE_SIZE / 8 + 96;

const LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET = LOCATION_OF_EXECUTION_PAYLOAD_OFFSET + VARIABLE_FIELD_OFFSET;

const LOCATION_OF_BLOB_KZG_COMMITMENTS_OFFSET = LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET + VARIABLE_FIELD_OFFSET;
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

const LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD =
  32 + 20 + 32 + 32 + BYTES_PER_LOGS_BLOOM + 32 + 8 + 8 + 8 + 8;

const LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD =
  LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD + VARIABLE_FIELD_OFFSET + 32 + 32;

const BLINDED_BLOCK_EXTRA_DATA_OFFSET_PRE_DENEB = 32 + 32 + 32 + 32;
const BLINDED_BLOCK_EXTRA_DATA_OFFSET_POST_DENEB = BLINDED_BLOCK_EXTRA_DATA_OFFSET_PRE_DENEB + 8 + 8;

const FULL_BLOCK_EXTRA_DATA_OFFSET_PRE_DENEB = 32 + 32 + VARIABLE_FIELD_OFFSET + VARIABLE_FIELD_OFFSET;
const FULL_BLOCK_EXTRA_DATA_OFFSET_POST_DENEB = FULL_BLOCK_EXTRA_DATA_OFFSET_PRE_DENEB + 8 + 8;

export function isSerializedBlinded(forkSeq: ForkSeq, blockBytes: Uint8Array): boolean {
  if (forkSeq < ForkSeq.bellatrix) {
    return false;
  }

  const dv = new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength);
  const executionPayloadOffset = dv.getUint32(LOCATION_OF_EXECUTION_PAYLOAD_OFFSET, true);
  const extraDataOffset = dv.getUint32(
    executionPayloadOffset + LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD,
    true
  );

  if (forkSeq < ForkSeq.deneb) {
    if (extraDataOffset === BLINDED_BLOCK_EXTRA_DATA_OFFSET_PRE_DENEB) {
      return true;
    }
    if (extraDataOffset === FULL_BLOCK_EXTRA_DATA_OFFSET_PRE_DENEB) {
      return false;
    }
  } else {
    if (extraDataOffset === BLINDED_BLOCK_EXTRA_DATA_OFFSET_POST_DENEB) {
      return true;
    }
    if (extraDataOffset === FULL_BLOCK_EXTRA_DATA_OFFSET_POST_DENEB) {
      return false;
    }
  }

  throw new Error("isSerializedBlindedBlock: invalid blockBytes");
}

function buildVariableOffset(value: number): Uint8Array {
  const offset = new Uint8Array(VARIABLE_FIELD_OFFSET);
  new DataView(offset.buffer).setUint32(0, value, true);
  return offset;
}

// same as isBlindedSignedBeaconBlock but without type narrowing
function isBlinded(block: allForks.FullOrBlindedSignedBeaconBlock): boolean {
  return (block as bellatrix.SignedBlindedBeaconBlock).message.body.executionPayloadHeader !== undefined;
}

export function serializeFullOrBlindedSignedBeaconBlock(
  config: ChainForkConfig,
  value: allForks.FullOrBlindedSignedBeaconBlock
): Uint8Array {
  return isBlinded(value)
    ? config.getBlindedForkTypes(value.message.slot).SignedBeaconBlock.serialize(value)
    : config.getForkTypes(value.message.slot).SignedBeaconBlock.serialize(value);
}

export function deserializeFullOrBlindedSignedBeaconBlock(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.FullOrBlindedSignedBeaconBlock {
  const slot = getSlotFromSignedBeaconBlockSerialized(bytes);
  if (slot === null) {
    throw Error("getSignedBlockTypeFromBytes: invalid bytes");
  }
  const forkSeq = config.getForkSeq(slot);

  return isSerializedBlinded(forkSeq, bytes)
    ? config.getBlindedForkTypes(slot).SignedBeaconBlock.deserialize(bytes)
    : config.getForkTypes(slot).SignedBeaconBlock.deserialize(bytes);
}

export function blindedOrFullSignedBlockToBlinded(
  config: ChainForkConfig,
  block: allForks.FullOrBlindedSignedBeaconBlock
): allForks.SignedBlindedBeaconBlock {
  if (isBlinded(block)) {
    return block;
  }

  const forkSeq = config.getForkSeq(block.message.slot);
  if (forkSeq < ForkSeq.bellatrix) {
    return block;
  }

  return config.getBlindedForkTypes(block.message.slot).SignedBeaconBlock.clone({
    signature: block.signature,
    message: {
      ...block.message,
      body: {
        ...(block.message.body as bellatrix.BeaconBlockBody),
        executionPayloadHeader: executionPayloadToPayloadHeader(
          forkSeq,
          (block.message.body as bellatrix.BeaconBlockBody).executionPayload
        ),
      },
    },
  });
}

export function blindedOrFullSignedBlockToBlindedBytes(
  config: ChainForkConfig,
  block: allForks.FullOrBlindedSignedBeaconBlock,
  blockBytes: Uint8Array
): Uint8Array {
  const forkSeq = config.getForkSeq(block.message.slot);
  /**
   * Phase0:
   *   return same data
   * Altair:
   *   return same data
   */
  if (forkSeq === ForkSeq.phase0 || forkSeq === ForkSeq.altair) {
    return blockBytes;
  }

  // take apart the block to get the offsets
  const dv = new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength);
  const executionPayloadOffset = dv.getUint32(LOCATION_OF_EXECUTION_PAYLOAD_OFFSET, true);
  const extraDataFixedOffset = executionPayloadOffset + LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD;
  let extraDataVariableOffset = dv.getUint32(extraDataFixedOffset, true);
  const transactionsFixedOffset = executionPayloadOffset + LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD;
  const transactionsVariableOffset = dv.getUint32(transactionsFixedOffset, true);

  // data for reassembly
  const preamble = Uint8Array.prototype.slice.call(blockBytes, 0, transactionsFixedOffset);
  const preambleDataView = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
  const extraData = Uint8Array.prototype.slice.call(blockBytes, extraDataVariableOffset, transactionsVariableOffset);
  const transactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot(
    (block as bellatrix.SignedBeaconBlock).message.body.executionPayload.transactions
  );

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

  let blsToExecutionChangeVariableOffset = dv.getUint32(LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET, true);
  const blsChangeAndMaybeCommitmentsData = Uint8Array.prototype.slice.call(
    blockBytes,
    blsToExecutionChangeVariableOffset
  );
  const withdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(
    (block as capella.SignedBeaconBlock).message.body.executionPayload.withdrawals
  );

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
    preambleDataView.setUint32(LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET, blsToExecutionChangeVariableOffset, true);
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
    blockBytes,
    startDataGasUsed,
    startDataGasUsed + 2 * 8
  );

  let blobCommitmentsVariableOffset = dv.getUint32(LOCATION_OF_BLOB_KZG_COMMITMENTS_OFFSET, true);
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
    preambleDataView.setUint32(LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET, blsToExecutionChangeVariableOffset, true);
    preambleDataView.setUint32(LOCATION_OF_BLOB_KZG_COMMITMENTS_OFFSET, blobCommitmentsVariableOffset, true);
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

export function reassembleBlindedBlockToFullBytes(
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

  // take apart the block to get the offsets
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const executionPayloadOffset = dv.getUint32(LOCATION_OF_EXECUTION_PAYLOAD_OFFSET, true);
  const extraDataFixedOffset = executionPayloadOffset + LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD;
  let extraDataVariableOffset = dv.getUint32(extraDataFixedOffset, true);
  const transactionsFixedOffset = executionPayloadOffset + LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD;

  // fields that are common to forks after Bellatrix
  if (!transactions) {
    throw new Error("must supply transaction");
  }

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
  let blsToExecutionChangeVariableOffset = dv.getUint32(LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET, true);
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
    preambleDataView.setUint32(LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET, blsToExecutionChangeVariableOffset, true);

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
    dv.getUint32(LOCATION_OF_BLOB_KZG_COMMITMENTS_OFFSET, true) - blsToExecutionChangeVariableOffset;

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
    preambleDataView.setUint32(LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET, blsToExecutionChangeVariableOffset, true);
    preambleDataView.setUint32(LOCATION_OF_BLOB_KZG_COMMITMENTS_OFFSET, blobCommitmentsVariableOffset, true);

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

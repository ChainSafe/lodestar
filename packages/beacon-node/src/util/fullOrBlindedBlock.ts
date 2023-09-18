import {ChainForkConfig} from "@lodestar/config";
import {ssz, allForks, bellatrix, capella, deneb} from "@lodestar/types";
import {BYTES_PER_LOGS_BLOOM, ForkSeq, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {executionPayloadToPayloadHeader} from "@lodestar/state-transition";
import {ROOT_SIZE, VARIABLE_FIELD_OFFSET, getSlotFromSignedBeaconBlockSerialized} from "./sszBytes.js";

export interface TransactionsAndWithdrawals {
  transactions?: Uint8Array[];
  withdrawals?: capella.Withdrawals;
}

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
 *
 * Capella:
 *   preamble: Fixed Length Data
 *   transactionsRoot: Root
 *   withdrawalsRoot: Root
 *   extraData: Variable Length Data
 *   blsToExecutionChanges: Variable Length Data
 *   - to -
 *   preamble: Fixed Length Data
 *   transactions: Variable Offset
 *   withdrawals: Variable Offset // cant know this offset until have transactions
 *   extraData: Variable Length Data
 *   transactions: Variable Length Data
 *   withdrawals: Variable Length Data
 *   blsToExecutionChanges: Variable Length Data
 *
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
 *   withdrawals: Variable Offset // cant know this offset until have transactions
 *   dataGasUsed: UintBn64
 *   excessDataGas: UintBn64
 *   extraData: Variable Length Data
 *   transactions: Variable Length Data
 *   withdrawals: Variable Length Data
 *   blsToExecutionChanges: Variable Length Data
 *   blobKzgCommitments: Variable Length Data
 */

/**
 *  * class SignedBeaconBlock(Container):
 *   message: BeaconBlock [offset - 4 bytes]
 *   signature: BLSSignature [fixed - 96 bytes]
 */
const SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH = 4 + 96;
/**
 * class BeaconBlock(Container) or class BlindedBeaconBlock(Container):
 *   slot: Slot                      [fixed - 8 bytes]
 *   proposer_index: ValidatorIndex  [fixed - 8 bytes]
 *   parent_root: Root               [fixed - 32 bytes]
 *   state_root: Root                [fixed - 32 bytes]
 *   body: MaybeBlindBeaconBlockBody [offset - 4 bytes]
 */
const BEACON_BLOCK_COMPENSATION_LENGTH = 8 + 8 + 32 + 32 + 4;
/**
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
function getOffsetWithinBeaconBlockBody(blockBytes: DataView, offset: number): number {
  const readAt = offset + SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH + BEACON_BLOCK_COMPENSATION_LENGTH;
  return blockBytes.getUint32(readAt, true);
}

const LOCATION_OF_ETH1_BLOCK_HASH = 96 + 32 + 8;
export function getEth1BlockHashFromSerializedBlock(block: Uint8Array): Uint8Array {
  const firstByte =
    SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH + BEACON_BLOCK_COMPENSATION_LENGTH + LOCATION_OF_ETH1_BLOCK_HASH;
  return block.slice(firstByte, firstByte + ROOT_SIZE);
}

const LOCATION_OF_PROPOSER_SLASHINGS_OFFSET = LOCATION_OF_ETH1_BLOCK_HASH + 32 + 32;
function getProposerSlashingsOffsetWithinBeaconBlockBody(blockBytes: DataView): number {
  return getOffsetWithinBeaconBlockBody(blockBytes, LOCATION_OF_PROPOSER_SLASHINGS_OFFSET);
}
function getProposerSlashingsOffset(blockBytes: DataView): number {
  return (
    getOffsetWithinBeaconBlockBody(blockBytes, LOCATION_OF_PROPOSER_SLASHINGS_OFFSET) +
    SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH +
    BEACON_BLOCK_COMPENSATION_LENGTH
  );
}

const LOCATION_OF_EXECUTION_PAYLOAD_OFFSET =
  LOCATION_OF_PROPOSER_SLASHINGS_OFFSET + 4 + 4 + 4 + 4 + 4 + SYNC_COMMITTEE_SIZE / 8 + 96;

function getExecutionPayloadOffset(blockBytes: DataView): number {
  return (
    getOffsetWithinBeaconBlockBody(blockBytes, LOCATION_OF_EXECUTION_PAYLOAD_OFFSET) +
    SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH +
    BEACON_BLOCK_COMPENSATION_LENGTH
  );
}

const LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET = LOCATION_OF_EXECUTION_PAYLOAD_OFFSET + VARIABLE_FIELD_OFFSET;
function getBlsToExecutionChangeOffset(blockBytes: DataView): number {
  return (
    getOffsetWithinBeaconBlockBody(blockBytes, LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET) +
    SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH +
    BEACON_BLOCK_COMPENSATION_LENGTH
  );
}
function setBlsToExecutionChangeOffset(blockBytes: DataView, newOffset: number): void {
  blockBytes.setUint32(
    LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET +
      SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH +
      BEACON_BLOCK_COMPENSATION_LENGTH,
    newOffset,
    true
  );
}

const LOCATION_OF_BLOB_KZG_COMMITMENTS_OFFSET = LOCATION_OF_BLS_TO_EXECUTION_CHANGE_OFFSET + VARIABLE_FIELD_OFFSET;
function getBlobKzgCommitmentsOffset(blockBytes: DataView): number {
  return getOffsetWithinBeaconBlockBody(blockBytes, LOCATION_OF_BLOB_KZG_COMMITMENTS_OFFSET);
}
function setBlobKzgCommitmentsOffset(blockBytes: DataView, newOffset: number): void {
  blockBytes.setUint32(
    LOCATION_OF_BLOB_KZG_COMMITMENTS_OFFSET +
      SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH +
      BEACON_BLOCK_COMPENSATION_LENGTH,
    newOffset,
    true
  );
}

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
function getOffsetWithinExecutionPayload(blockBytes: DataView, offset: number): number {
  const executionPayloadOffset = getExecutionPayloadOffset(blockBytes);
  const readAt = offset + executionPayloadOffset;
  return blockBytes.getUint32(readAt, true) + executionPayloadOffset;
}
function setOffsetWithinExecutionPayload(blockBytes: DataView, offsetLocation: number, newOffset: number): void {
  const executionPayloadOffset = getExecutionPayloadOffset(blockBytes);
  const writeAt = offsetLocation + executionPayloadOffset;
  blockBytes.setUint32(writeAt, newOffset - executionPayloadOffset, true);
}

const LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD =
  32 + 20 + 32 + 32 + BYTES_PER_LOGS_BLOOM + 32 + 8 + 8 + 8 + 8;
function getExtraDataOffset(blockBytes: DataView): number {
  return getOffsetWithinExecutionPayload(blockBytes, LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD);
}
// offset should be from start of executionPayload
function setExtraDataOffset(blockBytes: DataView, newOffset: number): void {
  return setOffsetWithinExecutionPayload(blockBytes, LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD, newOffset);
}

const LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD =
  LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD + VARIABLE_FIELD_OFFSET + 32 + 32;

function getTransactionsOffset(blockBytes: DataView): number {
  return getOffsetWithinExecutionPayload(blockBytes, LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD);
}

function buildVariableOffset(value: number): Uint8Array {
  const offset = new Uint8Array(VARIABLE_FIELD_OFFSET);
  new DataView(offset.buffer).setUint32(0, value, true);
  return offset;
}

function executionPayloadHeaderToPayload(
  forkSeq: ForkSeq,
  header: allForks.ExecutionPayloadHeader,
  {transactions, withdrawals}: TransactionsAndWithdrawals
): allForks.ExecutionPayload {
  const bellatrixPayloadFields: allForks.ExecutionPayload = {
    parentHash: header.parentHash,
    feeRecipient: header.feeRecipient,
    stateRoot: header.stateRoot,
    receiptsRoot: header.receiptsRoot,
    logsBloom: header.logsBloom,
    prevRandao: header.prevRandao,
    blockNumber: header.blockNumber,
    gasLimit: header.gasLimit,
    gasUsed: header.gasUsed,
    timestamp: header.timestamp,
    extraData: header.extraData,
    baseFeePerGas: header.baseFeePerGas,
    blockHash: header.blockHash,
    transactions: transactions ?? [],
  };

  if (forkSeq >= ForkSeq.capella) {
    (bellatrixPayloadFields as capella.ExecutionPayload).withdrawals = withdrawals ?? [];
  }

  if (forkSeq >= ForkSeq.deneb) {
    // https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#process_execution_payload
    (bellatrixPayloadFields as deneb.ExecutionPayload).blobGasUsed = (
      header as deneb.ExecutionPayloadHeader
    ).blobGasUsed;
    (bellatrixPayloadFields as deneb.ExecutionPayload).excessBlobGas = (
      header as deneb.ExecutionPayloadHeader
    ).excessBlobGas;
  }

  return bellatrixPayloadFields;
}

// same as isBlindedSignedBeaconBlock but without type narrowing
export function isBlinded(block: allForks.FullOrBlindedSignedBeaconBlock): boolean {
  return (block as bellatrix.SignedBlindedBeaconBlock).message.body.executionPayloadHeader !== undefined;
}

export function isBlindedBytes(forkSeq: ForkSeq, blockBytes: Uint8Array): boolean {
  if (forkSeq < ForkSeq.bellatrix) {
    return false;
  }

  const dv = new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength);
  const executionPayloadOffset = getExecutionPayloadOffset(dv);
  const readAt = LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD + executionPayloadOffset;
  const firstByte = dv.getUint32(readAt, true) + executionPayloadOffset;
  return firstByte - readAt > 93;
}

export function serializeFullOrBlindedSignedBeaconBlock(
  config: ChainForkConfig,
  value: allForks.FullOrBlindedSignedBeaconBlock
): Uint8Array {
  return isBlinded(value)
    ? config
        .getBlindedForkTypes(value.message.slot)
        .SignedBeaconBlock.serialize(value as allForks.SignedBlindedBeaconBlock)
    : config.getForkTypes(value.message.slot).SignedBeaconBlock.serialize(value as allForks.SignedBeaconBlock);
}

export function deserializeFullOrBlindedSignedBeaconBlock(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.FullOrBlindedSignedBeaconBlock {
  const slot = getSlotFromSignedBeaconBlockSerialized(bytes);
  if (slot === null) {
    throw Error("getSignedBlockTypeFromBytes: invalid bytes");
  }

  return isBlindedBytes(config.getForkSeq(slot), bytes)
    ? config.getBlindedForkTypes(slot).SignedBeaconBlock.deserialize(bytes)
    : config.getForkTypes(slot).SignedBeaconBlock.deserialize(bytes);
}

export function blindedOrFullBlockToBlinded(
  config: ChainForkConfig,
  block: allForks.FullOrBlindedSignedBeaconBlock
): allForks.SignedBlindedBeaconBlock {
  const forkSeq = config.getForkSeq(block.message.slot);
  if (isBlinded(block) || forkSeq < ForkSeq.bellatrix) {
    return block as allForks.SignedBlindedBeaconBlock;
  }

  const blinded = {
    signature: block.signature,
    message: {
      ...block.message,
      body: {
        randaoReveal: block.message.body.randaoReveal,
        eth1Data: block.message.body.eth1Data,
        graffiti: block.message.body.graffiti,
        proposerSlashings: block.message.body.proposerSlashings,
        attesterSlashings: block.message.body.attesterSlashings,
        attestations: block.message.body.attestations,
        deposits: block.message.body.deposits,
        voluntaryExits: block.message.body.voluntaryExits,
        syncAggregate: (block.message.body as bellatrix.BeaconBlockBody).syncAggregate,
        executionPayloadHeader: executionPayloadToPayloadHeader(
          forkSeq,
          (block.message.body as deneb.BeaconBlockBody).executionPayload
        ),
      },
    },
  };

  if (forkSeq >= ForkSeq.capella) {
    (blinded as capella.SignedBlindedBeaconBlock).message.body.blsToExecutionChanges = (
      block as capella.SignedBeaconBlock
    ).message.body.blsToExecutionChanges;
  }

  if (forkSeq >= ForkSeq.deneb) {
    (blinded as deneb.SignedBlindedBeaconBlock).message.body.blobKzgCommitments = (
      block as deneb.SignedBeaconBlock
    ).message.body.blobKzgCommitments;
  }

  return blinded;
}

export function blindedOrFullBlockToBlindedBytes(
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
  if (forkSeq < ForkSeq.bellatrix || isBlinded(block)) {
    return blockBytes;
  }

  // take apart the block to get the offsets
  const dv = new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength);
  const executionPayloadOffset = getExecutionPayloadOffset(dv);
  const extraDataOffset = getExtraDataOffset(dv);
  const transactionsOffset = getTransactionsOffset(dv);

  // bellatrix data for reassembly
  // slice firstChunk at end of blockHash / before transactions
  const firstChunk = Uint8Array.prototype.slice.call(
    blockBytes,
    0,
    executionPayloadOffset + LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD
  );
  const transactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot(
    (block as bellatrix.SignedBeaconBlock).message.body.executionPayload.transactions
  );
  const extraData = Uint8Array.prototype.slice.call(blockBytes, extraDataOffset, transactionsOffset);
  // create DataView to set new offsets
  const firstChunkDataView = new DataView(firstChunk.buffer, firstChunk.byteOffset, firstChunk.byteLength);
  let executionPayloadFixedDataLength = LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD + ROOT_SIZE;

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
    setExtraDataOffset(firstChunkDataView, executionPayloadOffset + executionPayloadFixedDataLength);
    const result = Buffer.concat([firstChunk, transactionsRoot, extraData]);
    return result;
  }

  // capella data for reassembly
  const withdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(
    (block as capella.SignedBeaconBlock).message.body.executionPayload.withdrawals
  );
  const blsToExecutionChangeOffset = getBlsToExecutionChangeOffset(dv);
  const blsChangeAndMaybeCommitmentsData = Uint8Array.prototype.slice.call(blockBytes, blsToExecutionChangeOffset);
  executionPayloadFixedDataLength += ROOT_SIZE;
  let executionPayloadLength = executionPayloadFixedDataLength + extraData.length;

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
    // update variable offsets
    setExtraDataOffset(firstChunkDataView, executionPayloadOffset + executionPayloadFixedDataLength);
    setBlsToExecutionChangeOffset(
      firstChunkDataView,
      executionPayloadOffset - // this offset is from beginning of block not BeaconBlockBody
        SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH -
        BEACON_BLOCK_COMPENSATION_LENGTH +
        executionPayloadLength
    );
    // build new data
    return Buffer.concat([firstChunk, transactionsRoot, withdrawalsRoot, extraData, blsChangeAndMaybeCommitmentsData]);
  }

  // get data for deneb offsets
  const startDataGasUsed = transactionsOffset + 2 * VARIABLE_FIELD_OFFSET;
  executionPayloadLength += 2 * 8;
  const blobCommitmentsOffset = getBlobKzgCommitmentsOffset(dv);
  const blsToExecutionChangeLength = blobCommitmentsOffset - blsToExecutionChangeOffset;
  // deneb data for reassembly
  const dataGasUsedAndExcessDataGas = Uint8Array.prototype.slice.call(
    blockBytes,
    startDataGasUsed,
    startDataGasUsed + 2 * 8
  );
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
    // update variable offsets
    setExtraDataOffset(firstChunkDataView, extraDataOffset);
    setBlsToExecutionChangeOffset(firstChunkDataView, blsToExecutionChangeOffset);
    setBlobKzgCommitmentsOffset(firstChunkDataView, executionPayloadLength + blsToExecutionChangeLength);
    // build new data
    return Buffer.concat([
      firstChunk,
      transactionsRoot,
      withdrawalsRoot,
      dataGasUsedAndExcessDataGas,
      extraData,
      blsChangeAndMaybeCommitmentsData,
    ]);
  }

  throw new Error("unknown forkSeq, cannot un-blind");
}

export function blindedOrFullToFull(
  config: ChainForkConfig,
  forkSeq: ForkSeq,
  block: allForks.FullOrBlindedSignedBeaconBlock,
  transactionsAndWithdrawals: TransactionsAndWithdrawals
): allForks.SignedBeaconBlock {
  if (
    !isBlinded(block) || // already full
    forkSeq < ForkSeq.bellatrix || // no execution payload
    (block.message as bellatrix.BeaconBlock).body.executionPayload?.timestamp === 0 // before merge
  ) {
    return block;
  }

  return config.getForkTypes(block.message.slot).SignedBeaconBlock.clone({
    signature: block.signature,
    message: {
      ...block.message,
      body: {
        ...(block.message.body as bellatrix.BeaconBlockBody),
        executionPayload: executionPayloadHeaderToPayload(
          forkSeq,
          (block.message.body as bellatrix.BlindedBeaconBlockBody).executionPayloadHeader,
          transactionsAndWithdrawals
        ),
      },
    },
  });
}

/**
 * Builds the full block in two chunks so that the first piece can be sent immediately
 * while the transactions and withdrawals are being fetched. All forks allow for
 * counting from the start of the executionPayload because there is no variable
 * length data before it.
 *
 * Pre-Capella, first chunk is everything up to and including the blockHash and
 * the second chunk is only the transactions.
 *
 * Post-Capella the blsToExecutionChanges offset needs to be updated so the
 * first chunk is up to and including the executionPayload offset. The second
 * chunk is from the start of the blsToExecutionChanges offset to the end of the
 * block.
 */
export async function* blindedOrFullToFullBytes(
  forkSeq: ForkSeq,
  block: Uint8Array,
  transactionsAndWithdrawals: Promise<TransactionsAndWithdrawals>
): AsyncIterable<Uint8Array> {
  /**
   * Phase0:
   *   return same data
   * Altair:
   *   return same data
   */
  if (forkSeq < ForkSeq.bellatrix || !isBlindedBytes(forkSeq, block)) {
    yield block;
    return;
  }

  // take apart the block to get the offsets
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const executionPayloadOffset = getExecutionPayloadOffset(dv);
  const extraDataOffset = getExtraDataOffset(dv);
  const transactionsRootOffset = executionPayloadOffset + LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD;

  // For bellatrix can go up to end of blockHash. For capella and after, the blsToExecutionChanges
  // and blobKzgCommitments offsets change because the length of the executionPayload changes. So
  // can send up to and including the executionPayload offset.
  let lengthOfFirstChunk: number;
  if (forkSeq < ForkSeq.capella) {
    lengthOfFirstChunk = transactionsRootOffset;
  } else {
    lengthOfFirstChunk =
      SIGNED_BEACON_BLOCK_COMPENSATION_LENGTH +
      BEACON_BLOCK_COMPENSATION_LENGTH +
      LOCATION_OF_EXECUTION_PAYLOAD_OFFSET +
      VARIABLE_FIELD_OFFSET;
  }

  // slice out extra data to get length
  let extraData: Uint8Array;
  let blsToExecutionChangeOffset: number | undefined;
  if (forkSeq < ForkSeq.capella) {
    extraData = Uint8Array.prototype.slice.call(block, extraDataOffset);
  } else {
    blsToExecutionChangeOffset = getBlsToExecutionChangeOffset(dv);
    extraData = Uint8Array.prototype.slice.call(block, extraDataOffset, blsToExecutionChangeOffset);
  }

  // start sending data across the wire
  const firstChunk = Uint8Array.prototype.slice.call(block, 0, lengthOfFirstChunk);
  if (forkSeq === ForkSeq.bellatrix) {
    // update extraData offset to be 28 bytes closer to start (32 byte root - 4 byte offset = 28 byte difference)
    setExtraDataOffset(
      new DataView(firstChunk.buffer, firstChunk.byteOffset, firstChunk.byteLength),
      extraDataOffset - 28
    );

    yield Buffer.concat([
      firstChunk,
      buildVariableOffset(
        LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD + VARIABLE_FIELD_OFFSET + extraData.length
      ),
      extraData,
    ]);
  } else {
    yield firstChunk;
  }

  // await getting transactions and withdrawals
  // need transactions length to calculate remaining offsets
  const {transactions, withdrawals} = await transactionsAndWithdrawals;
  if (!transactions) {
    throw new Error("must supply transactions");
  }

  const serializedTransactions = ssz.bellatrix.Transactions.serialize(transactions);
  // For bellatrix already calculated the offset and sent extraData. just need
  // to send transactions
  if (forkSeq === ForkSeq.bellatrix) {
    yield serializedTransactions;
    return;
  }
  // only capella blocks and after past here

  if (!withdrawals) {
    throw new Error("must supply withdrawals");
  }

  /**
   *
   * Build the executionPayload
   *
   */
  let dataGasUsedAndExcessDataGas: Uint8Array | undefined;
  if (forkSeq >= ForkSeq.deneb) {
    const startDataGasUsed = transactionsRootOffset + 2 * ROOT_SIZE;
    dataGasUsedAndExcessDataGas = Uint8Array.prototype.slice.call(block, startDataGasUsed, startDataGasUsed + 2 * 8);
  }

  const newExtraDataOffset =
    LOCATION_OF_TRANSACTIONS_OFFSET_WITHIN_EXECUTION_PAYLOAD +
    2 * VARIABLE_FIELD_OFFSET +
    (dataGasUsedAndExcessDataGas ? dataGasUsedAndExcessDataGas.length : 0);
  const newTransactionsOffset = newExtraDataOffset + extraData.length;
  const newWithdrawalsOffset = newTransactionsOffset + serializedTransactions.length;

  const executionPayload = Buffer.concat([
    Uint8Array.prototype.slice.call(block, executionPayloadOffset, transactionsRootOffset),
    buildVariableOffset(newTransactionsOffset),
    buildVariableOffset(newWithdrawalsOffset),
    dataGasUsedAndExcessDataGas ?? Uint8Array.from([]),
    extraData,
    serializedTransactions,
    ssz.capella.Withdrawals.serialize(withdrawals),
  ]);
  new DataView(executionPayload.buffer, executionPayload.byteOffset, executionPayload.byteLength).setUint32(
    LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD,
    newExtraDataOffset,
    true
  );

  const proposerSlashingsOffset = getProposerSlashingsOffset(dv);
  const unchangedVariableLengthData = Uint8Array.prototype.slice.call(
    block,
    proposerSlashingsOffset,
    executionPayloadOffset
  );
  const lastChunk = Uint8Array.prototype.slice.call(block, blsToExecutionChangeOffset);
  // this will be BeaconBlockBody static data plus variable length data up to and including executionPayload
  const newBlsToExecutionChangeOffset =
    getProposerSlashingsOffsetWithinBeaconBlockBody(dv) + unchangedVariableLengthData.length + executionPayload.length;
  let newBlobKzgCommitmentsOffset: number | undefined;
  if (forkSeq >= ForkSeq.deneb) {
    newBlobKzgCommitmentsOffset =
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      dv.getUint32(LOCATION_OF_BLOB_KZG_COMMITMENTS_OFFSET, true) - blsToExecutionChangeOffset!;
  }

  // for post-bellatrix already sent executionPayload offset. start with newBlsToExecutionChangeOffset
  yield Buffer.concat([
    buildVariableOffset(newBlsToExecutionChangeOffset),
    newBlobKzgCommitmentsOffset !== undefined ? buildVariableOffset(newBlobKzgCommitmentsOffset) : Uint8Array.from([]),
    unchangedVariableLengthData,
    executionPayload,
    lastChunk,
  ]);
}

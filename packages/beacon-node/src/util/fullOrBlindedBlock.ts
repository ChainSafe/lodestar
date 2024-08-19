import {ChainForkConfig} from "@lodestar/config";
import {
  BeaconBlock,
  bellatrix,
  BlindedBeaconBlock,
  capella,
  deneb,
  ExecutionPayload,
  ExecutionPayloadHeader,
  isBlindedSignedBeaconBlock,
  SignedBeaconBlock,
  SignedBlindedBeaconBlock,
} from "@lodestar/types";
import {BYTES_PER_LOGS_BLOOM, ForkSeq, ForkName, isForkExecution, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {ExecutionPayloadBody} from "../execution/engine/types.js";
import {ROOT_SIZE, getSlotFromSignedBeaconBlockSerialized} from "./sszBytes.js";

/**
 *  * class SignedBeaconBlock(Container):
 *   message: BeaconBlock [offset - 4 bytes]
 *   signature: BLSSignature [fixed - 96 bytes]
 */
const SIGNED_BEACON_BLOCK_FIXED_LENGTH = 4 + 96;
/**
 * class BeaconBlock(Container) or class BlindedBeaconBlock(Container):
 *   slot: Slot                      [fixed - 8 bytes]
 *   proposer_index: ValidatorIndex  [fixed - 8 bytes]
 *   parent_root: Root               [fixed - 32 bytes]
 *   state_root: Root                [fixed - 32 bytes]
 *   body: MaybeBlindBeaconBlockBody [offset - 4 bytes]
 */
const BEACON_BLOCK_FIXED_LENGTH = 8 + 8 + 32 + 32 + 4;
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

const LOCATION_OF_ETH1_BLOCK_HASH = 96 + 32 + 8;
export function getEth1BlockHashFromSerializedBlock(block: Uint8Array): Uint8Array {
  const firstByte = SIGNED_BEACON_BLOCK_FIXED_LENGTH + BEACON_BLOCK_FIXED_LENGTH + LOCATION_OF_ETH1_BLOCK_HASH;
  return block.slice(firstByte, firstByte + ROOT_SIZE);
}

const LOCATION_OF_EXECUTION_PAYLOAD_OFFSET =
  LOCATION_OF_ETH1_BLOCK_HASH + 32 + 32 + 4 + 4 + 4 + 4 + 4 + SYNC_COMMITTEE_SIZE / 8 + 96;

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

export function isBlindedBytes(forkSeq: ForkSeq, blockBytes: Uint8Array): boolean {
  if (forkSeq < ForkSeq.bellatrix) {
    return false;
  }

  const dv = new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength);

  // read the executionPayload offset, encoded as offset from start of BeaconBlockBody and compensate with the fixed
  // data length of the SignedBeaconBlock and BeaconBlock to get absolute offset from start of bytes
  const readExecutionPayloadOffsetAt =
    LOCATION_OF_EXECUTION_PAYLOAD_OFFSET + SIGNED_BEACON_BLOCK_FIXED_LENGTH + BEACON_BLOCK_FIXED_LENGTH;
  const executionPayloadOffset =
    dv.getUint32(readExecutionPayloadOffsetAt, true) + SIGNED_BEACON_BLOCK_FIXED_LENGTH + BEACON_BLOCK_FIXED_LENGTH;

  // read the extraData offset, encoded as offset from start of ExecutionPayload and compensate with absolute offset of
  // executionPayload to get location of first byte of extraData
  const readExtraDataOffsetAt = LOCATION_OF_EXTRA_DATA_OFFSET_WITHIN_EXECUTION_PAYLOAD + executionPayloadOffset;
  const firstByte = dv.getUint32(readExtraDataOffsetAt, true) + executionPayloadOffset;

  // compare first byte of extraData with location of the offset of the extraData.  In full blocks the distance between
  // the offset and first byte is at maximum 4 + 32 + 32 + 4 + 4 + 8 + 8 = 92.  In blinded blocks the distance at minimum
  // is 4 + 32 + 32 + 4 + 4 + 32 = 108.  Therefore if the distance is 93 or greater it must be blinded
  return firstByte - readExtraDataOffsetAt > 92;
}

export function serializeFullOrBlindedSignedBeaconBlock(
  config: ChainForkConfig,
  value: SignedBeaconBlock | SignedBlindedBeaconBlock
): Uint8Array {
  if (isBlindedSignedBeaconBlock(value)) {
    const type = config.getExecutionForkTypes(value.message.slot).SignedBlindedBeaconBlock;
    return type.serialize(value);
  }
  const type = config.getForkTypes(value.message.slot).SignedBeaconBlock;
  return type.serialize(value);
}

export function deserializeFullOrBlindedSignedBeaconBlock(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): SignedBeaconBlock | SignedBlindedBeaconBlock {
  const slot = getSlotFromSignedBeaconBlockSerialized(bytes);
  if (slot === null) {
    throw Error("getSignedBlockTypeFromBytes: invalid bytes");
  }

  return isBlindedBytes(config.getForkSeq(slot), bytes)
    ? config.getExecutionForkTypes(slot).SignedBeaconBlock.deserialize(bytes)
    : config.getForkTypes(slot).SignedBeaconBlock.deserialize(bytes);
}

function executionPayloadHeaderToPayload(
  forkSeq: ForkSeq,
  header: ExecutionPayloadHeader,
  {transactions, withdrawals}: Partial<ExecutionPayloadBody>
): ExecutionPayload {
  const bellatrixPayloadFields: ExecutionPayload = {
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

// TODO: (@matthewkeil) not the same as blindedOrFullBlockToFull in state-transition. consider merging?
export function blindedOrFullBlockToFull(
  config: ChainForkConfig,
  block: SignedBeaconBlock | SignedBlindedBeaconBlock,
  transactionsAndWithdrawals: Partial<ExecutionPayloadBody>
): SignedBeaconBlock {
  if (
    !isBlindedSignedBeaconBlock(block) || // already full
    !isForkExecution(config.getForkName(block.message.slot)) || // no execution payload
    (block as unknown as SignedBeaconBlock<ForkName.bellatrix>).message.body.executionPayload.timestamp === 0 // before merge
  ) {
    return block;
  }

  return config.getForkTypes(block.message.slot).SignedBeaconBlock.clone({
    signature: block.signature,
    message: {
      ...block.message,
      body: {
        ...block.message.body,
        executionPayload: executionPayloadHeaderToPayload(
          config.getForkSeq(block.message.slot),
          (block.message.body as bellatrix.BlindedBeaconBlockBody).executionPayloadHeader,
          transactionsAndWithdrawals
        ),
      },
    },
  });
}

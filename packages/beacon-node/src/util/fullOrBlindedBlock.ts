import {ChainForkConfig} from "@lodestar/config";
import {allForks, bellatrix} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {executionPayloadToPayloadHeader} from "@lodestar/state-transition";
import {getSlotFromSignedBeaconBlockSerialized} from "./sszBytes.js";

export function isSerializedBlindedBlock(blockBytes: Uint8Array): boolean {
  // TODO: (matthewkeil) Temp to get build working
  blockBytes;
  return true;
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
    : config.getForkTypes((value as allForks.SignedBeaconBlock).message.slot).SignedBeaconBlock.serialize(value);
}

export function deserializeFullOrBlindedSignedBeaconBlock(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.FullOrBlindedSignedBeaconBlock {
  const slot = getSlotFromSignedBeaconBlockSerialized(bytes);
  if (slot === null) {
    throw Error("getSignedBlockTypeFromBytes: invalid bytes");
  }

  return isSerializedBlindedBlock(bytes)
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
  // TODO: (matthewkeil) Temp to get build working
  block;
  return blockBytes;
}

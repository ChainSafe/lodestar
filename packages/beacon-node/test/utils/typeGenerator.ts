import {Slot} from "@lodestar/types";
import {phase0} from "@lodestar/types";
import {ProtoBlock, ExecutionStatus} from "@lodestar/fork-choice";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ZERO_HASH_HEX} from "../../src/constants/index.js";

// Only add functions for types that need some property changed.
// For the "empty" or "zero" type just use:
// ```
// ssz.phase.TypeName.defaultValue()
// ```
// If you only need to modify the type in a single test file, add a helper there.
// Only move here if the file has to be shared between multiple files.

export const VALID_BLS_SIGNATURE_RAND = fromHex(
  "99cb82bc69b4111d1a828963f0316ec9aa38c4e9e041a8afec86cd20dfe9a590999845bf01d4689f3bbe3df54e48695e081f1216027b577c7fccf6ab0a4fcc75faf8009c6b55e518478139f604f542d138ae3bc34bad01ee6002006d64c4ff82"
);

export function generateSignedBlockAtSlot(slot: Slot): phase0.SignedBeaconBlock {
  const block = ssz.phase0.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  return block;
}

export function generateProtoBlock(overrides: Partial<ProtoBlock> = {}): ProtoBlock {
  return {
    ...overrides,

    slot: 0,
    blockRoot: ZERO_HASH_HEX,
    parentRoot: ZERO_HASH_HEX,
    stateRoot: ZERO_HASH_HEX,
    targetRoot: ZERO_HASH_HEX,

    justifiedEpoch: 0,
    justifiedRoot: ZERO_HASH_HEX,
    finalizedEpoch: 0,
    finalizedRoot: ZERO_HASH_HEX,
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: ZERO_HASH_HEX,
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: ZERO_HASH_HEX,

    ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
  };
}

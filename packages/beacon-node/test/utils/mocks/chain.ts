import {ProtoBlock, ExecutionStatus} from "@lodestar/fork-choice";
import {ZERO_HASH_HEX} from "../../../src/constants/constants.js";

export const zeroProtoBlock: ProtoBlock = {
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

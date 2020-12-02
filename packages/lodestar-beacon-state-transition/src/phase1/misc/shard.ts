import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CommitteeIndex, Gwei, Phase1, Slot, Uint64} from "@chainsafe/lodestar-types";
import {bigIntMax, bigIntMin} from "@chainsafe/lodestar-utils";
import {getActiveShardCount, getStartShard} from "../state";

export function computeShardFromCommitteeIndex(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  index: CommitteeIndex,
  slot: Slot
): Phase1.Shard {
  const activeShard = getActiveShardCount(config, state);
  return (index + getStartShard(config, state, slot)) % activeShard;
}

export function computeUpdatedGasprice(config: IBeaconConfig, prevGasprice: Gwei, shardBlockLength: Uint64): Gwei {
  if (shardBlockLength > config.params.phase1.TARGET_SHARD_BLOCK_SIZE) {
    const delta =
      (prevGasprice * (shardBlockLength - BigInt(config.params.phase1.TARGET_SHARD_BLOCK_SIZE))) /
      BigInt(config.params.phase1.TARGET_SHARD_BLOCK_SIZE) /
      BigInt(config.params.phase1.MAX_GASPRICE);
    return bigIntMin(prevGasprice + delta, BigInt(config.params.phase1.MAX_GASPRICE));
  } else {
    const delta =
      (prevGasprice * (BigInt(config.params.phase1.TARGET_SHARD_BLOCK_SIZE) - shardBlockLength)) /
      BigInt(config.params.phase1.TARGET_SHARD_BLOCK_SIZE) /
      BigInt(config.params.phase1.GASPRICE_ADJUSTMENT_COEFFICIENT);

    return bigIntMax(prevGasprice, BigInt(config.params.phase1.MIN_GASPRICE) + delta) - delta;
  }
}

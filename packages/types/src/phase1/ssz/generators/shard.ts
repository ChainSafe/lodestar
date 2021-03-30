import {ContainerType, ListType} from "@chainsafe/ssz";
import * as phase1 from "../../types";
import {Phase1Generator} from "./interface";

export const ShardBlock: Phase1Generator<ContainerType<phase1.ShardBlock>> = (params, altairTypes, phase1Types) => {
  return new ContainerType({
    fields: {
      shardParentRoot: altairTypes.Root,
      beaconParentRoot: altairTypes.Root,
      slot: altairTypes.Slot,
      shard: phase1Types.Shard,
      proposerIndex: altairTypes.ValidatorIndex,
      body: new ListType({
        elementType: altairTypes.Uint8,
        limit: params.MAX_SHARD_BLOCK_SIZE,
      }),
    },
  });
};

export const SignedShardBlock: Phase1Generator<ContainerType<phase1.SignedShardBlock>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      message: phase1Types.ShardBlock,
      signature: altairTypes.BLSSignature,
    },
  });
};

export const ShardBlockHeader: Phase1Generator<ContainerType<phase1.ShardBlockHeader>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      shardParentRoot: altairTypes.Root,
      beaconParentRoot: altairTypes.Root,
      slot: altairTypes.Slot,
      shard: phase1Types.Shard,
      proposerIndex: altairTypes.ValidatorIndex,
      bodyRoot: altairTypes.Root,
    },
  });
};

export const ShardState: Phase1Generator<ContainerType<phase1.ShardState>> = (params, altairTypes) => {
  return new ContainerType({
    fields: {
      slot: altairTypes.Slot,
      gasprice: altairTypes.Gwei,
      latestBlockRoot: altairTypes.Root,
    },
  });
};

export const ShardTransition: Phase1Generator<ContainerType<phase1.ShardTransition>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      startSlot: altairTypes.Slot,
      shardBlockLengths: new ListType({
        elementType: altairTypes.Uint64,
        limit: params.MAX_SHARD_BLOCKS_PER_ATTESTATION,
      }),
      shardDataRoots: new ListType({
        elementType: altairTypes.Bytes32,
        limit: params.MAX_SHARD_BLOCKS_PER_ATTESTATION,
      }),
      shardStates: new ListType({
        elementType: phase1Types.ShardState,
        limit: params.MAX_SHARD_BLOCKS_PER_ATTESTATION,
      }),
      proposerSignatureAggregate: altairTypes.BLSSignature,
    },
  });
};

export const CompactCommittee: Phase1Generator<ContainerType<phase1.CompactCommittee>> = (params, types) => {
  return new ContainerType({
    fields: {
      pubkeys: new ListType({
        elementType: types.BLSPubkey,
        limit: params.MAX_VALIDATORS_PER_COMMITTEE,
      }),
      compactValidators: new ListType({
        elementType: types.Uint64,
        limit: params.MAX_VALIDATORS_PER_COMMITTEE,
      }),
    },
  });
};

import {ContainerType, ListType} from "@chainsafe/ssz";
import * as phase1 from "../../types";
import {Phase1Generator} from "./interface";

export const ShardBlock: Phase1Generator<ContainerType<phase1.ShardBlock>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      shardParentRoot: lightclientTypes.Root,
      beaconParentRoot: lightclientTypes.Root,
      slot: lightclientTypes.Slot,
      shard: phase1Types.Shard,
      proposerIndex: lightclientTypes.ValidatorIndex,
      body: new ListType({
        elementType: lightclientTypes.Uint8,
        limit: params.MAX_SHARD_BLOCK_SIZE,
      }),
    },
  });
};

export const SignedShardBlock: Phase1Generator<ContainerType<phase1.SignedShardBlock>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      message: phase1Types.ShardBlock,
      signature: lightclientTypes.BLSSignature,
    },
  });
};

export const ShardBlockHeader: Phase1Generator<ContainerType<phase1.ShardBlockHeader>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      shardParentRoot: lightclientTypes.Root,
      beaconParentRoot: lightclientTypes.Root,
      slot: lightclientTypes.Slot,
      shard: phase1Types.Shard,
      proposerIndex: lightclientTypes.ValidatorIndex,
      bodyRoot: lightclientTypes.Root,
    },
  });
};

export const ShardState: Phase1Generator<ContainerType<phase1.ShardState>> = (params, lightclientTypes) => {
  return new ContainerType({
    fields: {
      slot: lightclientTypes.Slot,
      gasprice: lightclientTypes.Gwei,
      latestBlockRoot: lightclientTypes.Root,
    },
  });
};

export const ShardTransition: Phase1Generator<ContainerType<phase1.ShardTransition>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      startSlot: lightclientTypes.Slot,
      shardBlockLengths: new ListType({
        elementType: lightclientTypes.Uint64,
        limit: params.MAX_SHARD_BLOCKS_PER_ATTESTATION,
      }),
      shardDataRoots: new ListType({
        elementType: lightclientTypes.Bytes32,
        limit: params.MAX_SHARD_BLOCKS_PER_ATTESTATION,
      }),
      shardStates: new ListType({
        elementType: phase1Types.ShardState,
        limit: params.MAX_SHARD_BLOCKS_PER_ATTESTATION,
      }),
      proposerSignatureAggregate: lightclientTypes.BLSSignature,
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

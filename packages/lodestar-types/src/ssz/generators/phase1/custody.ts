import {ByteVectorType, ContainerType, ListType, VectorType} from "@chainsafe/ssz";
import * as t from "../../../types/phase1/types";
import {Phase1Generator} from "./interface";

export const CustodyChunkChallenge: Phase1Generator<
  ContainerType<t.CustodyChunkChallenge>,
  "ShardTransition" | "Attestation"
> = (params, types, phase1Types) => {
  return new ContainerType({
    fields: {
      responderIndex: types.ValidatorIndex,
      shardTransition: phase1Types.ShardTransition,
      attestation: phase1Types.Attestation,
      dataIndex: types.Uint64,
      chunkIndex: types.Uint64,
    },
  });
};

export const CustodyChunkChallengeRecord: Phase1Generator<ContainerType<t.CustodyChunkChallengeRecord>> = (
  params,
  types
) => {
  return new ContainerType({
    fields: {
      challengeIndex: types.Uint64,
      challengerIndex: types.ValidatorIndex,
      responderIndex: types.ValidatorIndex,
      inclusionEpoch: types.Epoch,
      dataRoot: types.Root,
      chunkIndex: types.Uint64,
    },
  });
};

export const CustodyChunkResponse: Phase1Generator<ContainerType<t.CustodyChunkResponse>> = (params, types) => {
  return new ContainerType({
    fields: {
      challengeIndex: types.Uint64,
      chunkIndex: types.Uint64,
      chunk: new ByteVectorType({
        length: params.phase1.BYTES_PER_CUSTODY_CHUNK,
      }),
      branch: new VectorType({
        elementType: types.Root,
        length: params.phase1.CUSTODY_RESPONSE_DEPTH + 1,
      }),
    },
  });
};

export const CustodySlashing: Phase1Generator<ContainerType<t.CustodySlashing>, "ShardTransition" | "Attestation"> = (
  params,
  types,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      dataIndex: types.Uint64,
      malefactorIndex: types.ValidatorIndex,
      malefactorSecret: types.BLSSignature,
      whistleblowerIndex: types.ValidatorIndex,
      shardTransition: phase1Types.ShardTransition,
      attestation: phase1Types.Attestation,
      data: new ListType({
        elementType: types.Uint8,
        limit: params.phase1.MAX_SHARD_BLOCK_SIZE,
      }),
    },
  });
};

export const SignedCustodySlashing: Phase1Generator<ContainerType<t.SignedCustodySlashing>, "CustodySlashing"> = (
  params,
  types,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      message: phase1Types.CustodySlashing,
      signature: types.BLSSignature,
    },
  });
};

export const CustodyKeyReveal: Phase1Generator<ContainerType<t.CustodyKeyReveal>> = (params, types) => {
  return new ContainerType({
    fields: {
      revealerIndex: types.ValidatorIndex,
      reveal: types.BLSSignature,
    },
  });
};

export const EarlyDerivedSecretReveal: Phase1Generator<ContainerType<t.EarlyDerivedSecretReveal>> = (params, types) => {
  return new ContainerType({
    fields: {
      revealedIndex: types.ValidatorIndex,
      epoch: types.Epoch,
      reveal: types.BLSSignature,
      maskerIndex: types.ValidatorIndex,
      mask: types.Bytes32,
    },
  });
};

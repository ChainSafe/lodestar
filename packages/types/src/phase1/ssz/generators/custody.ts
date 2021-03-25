import {ByteVectorType, ContainerType, ListType, VectorType} from "@chainsafe/ssz";

import * as phase1 from "../../types";
import {Phase1Generator} from "./interface";

export const CustodyChunkChallenge: Phase1Generator<ContainerType<phase1.CustodyChunkChallenge>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      responderIndex: lightclientTypes.ValidatorIndex,
      shardTransition: phase1Types.ShardTransition,
      attestation: phase1Types.Attestation,
      dataIndex: lightclientTypes.Uint64,
      chunkIndex: lightclientTypes.Uint64,
    },
  });
};

export const CustodyChunkChallengeRecord: Phase1Generator<ContainerType<phase1.CustodyChunkChallengeRecord>> = (
  params,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      challengeIndex: lightclientTypes.Uint64,
      challengerIndex: lightclientTypes.ValidatorIndex,
      responderIndex: lightclientTypes.ValidatorIndex,
      inclusionEpoch: lightclientTypes.Epoch,
      dataRoot: lightclientTypes.Root,
      chunkIndex: lightclientTypes.Uint64,
    },
  });
};

export const CustodyChunkResponse: Phase1Generator<ContainerType<phase1.CustodyChunkResponse>> = (
  params,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      challengeIndex: lightclientTypes.Uint64,
      chunkIndex: lightclientTypes.Uint64,
      chunk: new ByteVectorType({
        length: params.BYTES_PER_CUSTODY_CHUNK,
      }),
      branch: new VectorType({
        elementType: lightclientTypes.Root,
        length: params.CUSTODY_RESPONSE_DEPTH + 1,
      }),
    },
  });
};

export const CustodySlashing: Phase1Generator<ContainerType<phase1.CustodySlashing>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      dataIndex: lightclientTypes.Uint64,
      malefactorIndex: lightclientTypes.ValidatorIndex,
      malefactorSecret: lightclientTypes.BLSSignature,
      whistleblowerIndex: lightclientTypes.ValidatorIndex,
      shardTransition: phase1Types.ShardTransition,
      attestation: phase1Types.Attestation,
      data: new ListType({
        elementType: lightclientTypes.Uint8,
        limit: params.MAX_SHARD_BLOCK_SIZE,
      }),
    },
  });
};

export const SignedCustodySlashing: Phase1Generator<ContainerType<phase1.SignedCustodySlashing>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      message: phase1Types.CustodySlashing,
      signature: lightclientTypes.BLSSignature,
    },
  });
};

export const CustodyKeyReveal: Phase1Generator<ContainerType<phase1.CustodyKeyReveal>> = (params, lightclientTypes) => {
  return new ContainerType({
    fields: {
      revealerIndex: lightclientTypes.ValidatorIndex,
      reveal: lightclientTypes.BLSSignature,
    },
  });
};

export const EarlyDerivedSecretReveal: Phase1Generator<ContainerType<phase1.EarlyDerivedSecretReveal>> = (
  params,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      revealedIndex: lightclientTypes.ValidatorIndex,
      epoch: lightclientTypes.Epoch,
      reveal: lightclientTypes.BLSSignature,
      maskerIndex: lightclientTypes.ValidatorIndex,
      mask: lightclientTypes.Bytes32,
    },
  });
};

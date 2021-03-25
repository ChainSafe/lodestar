import {BitVectorType, ContainerType, ListType, VectorType} from "@chainsafe/ssz";

import * as phase1 from "../../types";
import {Phase1Generator} from "./interface";

export const BeaconBlockBody: Phase1Generator<ContainerType<phase1.BeaconBlockBody>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.BeaconBlockBody.fields,
      //override old types
      attestations: new ListType({
        elementType: phase1Types.Attestation,
        limit: params.MAX_ATTESTATIONS,
      }),
      attesterSlashings: new ListType({
        elementType: phase1Types.AttesterSlashing,
        limit: params.MAX_ATTESTER_SLASHINGS,
      }),
      //new properties
      chunkChallenges: new ListType({
        elementType: phase1Types.CustodyChunkChallenge,
        limit: params.MAX_CUSTODY_CHUNK_CHALLENGES,
      }),
      chunkChallengeResponses: new ListType({
        elementType: phase1Types.CustodyChunkResponse,
        limit: params.MAX_CUSTODY_CHUNK_CHALLENGE_RESPONSES,
      }),
      custodyKeyReveals: new ListType({
        elementType: phase1Types.CustodyKeyReveal,
        limit: params.MAX_CUSTODY_KEY_REVEALS,
      }),
      earlyDerivedSecretReveals: new ListType({
        elementType: phase1Types.EarlyDerivedSecretReveal,
        limit: params.MAX_EARLY_DERIVED_SECRET_REVEALS,
      }),
      custodySlashing: new ListType({
        elementType: phase1Types.SignedCustodySlashing,
        limit: params.MAX_CUSTODY_SLASHINGS,
      }),
      shardTransitions: new VectorType({
        elementType: phase1Types.ShardTransition,
        length: params.MAX_SHARDS,
      }),
      lightClientBits: new BitVectorType({length: params.LIGHT_CLIENT_COMMITTEE_SIZE}),
      lightClientSignature: lightclientTypes.BLSSignature,
    },
  });
};

export const BeaconBlock: Phase1Generator<ContainerType<phase1.BeaconBlock>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.BeaconBlock.fields,
      body: phase1Types.BeaconBlockBody,
    },
  });
};

export const SignedBeaconBlock: Phase1Generator<ContainerType<phase1.SignedBeaconBlock>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.SignedBeaconBlock.fields,
      message: phase1Types.BeaconBlock,
    },
  });
};

export const BeaconState: Phase1Generator<ContainerType<phase1.BeaconState>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.BeaconState.fields,
      validator: phase1Types.Validator,
      previousEpochAttestations: new ListType({
        elementType: phase1Types.PendingAttestation,
        limit: params.MAX_ATTESTATIONS * params.SLOTS_PER_EPOCH,
      }),
      currentEpochAttestations: new ListType({
        elementType: phase1Types.PendingAttestation,
        limit: params.MAX_ATTESTATIONS * params.SLOTS_PER_EPOCH,
      }),
      //phase1
      currentEpochStartShard: phase1Types.Shard,
      shardStates: new ListType({
        elementType: phase1Types.ShardState,
        limit: params.MAX_SHARDS,
      }),
      onlineCountdown: new ListType({
        elementType: phase1Types.OnlineEpochs,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      currentLightCommittee: phase1Types.CompactCommittee,
      nextLightCommittee: phase1Types.CompactCommittee,
      exposedDerivedSecrets: new VectorType({
        elementType: new ListType({
          elementType: lightclientTypes.ValidatorIndex,
          limit: params.MAX_EARLY_DERIVED_SECRET_REVEALS * params.SLOTS_PER_EPOCH,
        }),
        length: params.EARLY_DERIVED_SECRET_PENALTY_MAX_FUTURE_EPOCHS,
      }),
      custodyChunkChallengeRecords: new ListType({
        elementType: phase1Types.CustodyChunkChallengeRecord,
        limit: params.MAX_CUSTODY_CHUNK_CHALLENGE_RECORDS,
      }),
      custodyChunkChallengeIndex: lightclientTypes.Uint64,
    },
  });
};

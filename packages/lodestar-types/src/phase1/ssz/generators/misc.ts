import {ContainerType} from "@chainsafe/ssz";
import * as phase1 from "../../types";
import {Phase1Generator} from "./interface";

export const AttestationData: Phase1Generator<ContainerType<phase1.AttestationData>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.AttestationData.fields,
      shard: phase1Types.Shard,
      shardHeadRoot: lightclientTypes.Root,
      shardTransitionRoot: lightclientTypes.Root,
    },
  });
};

export const Attestation: Phase1Generator<ContainerType<phase1.Attestation>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.Attestation.fields,
      data: phase1Types.AttestationData,
    },
  });
};

export const IndexedAttestation: Phase1Generator<ContainerType<phase1.IndexedAttestation>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.IndexedAttestation.fields,
      data: phase1Types.AttestationData,
    },
  });
};

export const PendingAttestation: Phase1Generator<ContainerType<phase1.PendingAttestation>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.PendingAttestation.fields,
      data: phase1Types.AttestationData,
      crosslinkSuccess: lightclientTypes.Boolean,
    },
  });
};

export const AttesterSlashing: Phase1Generator<ContainerType<phase1.AttesterSlashing>> = (
  params,
  lightclientTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.AttesterSlashing.fields,
      attestation1: phase1Types.IndexedAttestation,
      attestation2: phase1Types.IndexedAttestation,
    },
  });
};

export const Validator: Phase1Generator<ContainerType<phase1.Validator>> = (params, lightclientTypes) => {
  return new ContainerType({
    fields: {
      ...lightclientTypes.Validator.fields,
      nextCustodySecretToReveal: lightclientTypes.Uint64,
      allCustodySecretsRevealedEpoch: lightclientTypes.Epoch,
    },
  });
};

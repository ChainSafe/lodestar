import {ContainerType} from "@chainsafe/ssz";
import * as phase1 from "../../types";
import {Phase1Generator} from "./interface";

export const AttestationData: Phase1Generator<ContainerType<phase1.AttestationData>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...altairTypes.AttestationData.fields,
      shard: phase1Types.Shard,
      shardHeadRoot: altairTypes.Root,
      shardTransitionRoot: altairTypes.Root,
    },
  });
};

export const Attestation: Phase1Generator<ContainerType<phase1.Attestation>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...altairTypes.Attestation.fields,
      data: phase1Types.AttestationData,
    },
  });
};

export const IndexedAttestation: Phase1Generator<ContainerType<phase1.IndexedAttestation>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...altairTypes.IndexedAttestation.fields,
      data: phase1Types.AttestationData,
    },
  });
};

export const PendingAttestation: Phase1Generator<ContainerType<phase1.PendingAttestation>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...altairTypes.PendingAttestation.fields,
      data: phase1Types.AttestationData,
      crosslinkSuccess: altairTypes.Boolean,
    },
  });
};

export const AttesterSlashing: Phase1Generator<ContainerType<phase1.AttesterSlashing>> = (
  params,
  altairTypes,
  phase1Types
) => {
  return new ContainerType({
    fields: {
      ...altairTypes.AttesterSlashing.fields,
      attestation1: phase1Types.IndexedAttestation,
      attestation2: phase1Types.IndexedAttestation,
    },
  });
};

export const Validator: Phase1Generator<ContainerType<phase1.Validator>> = (params, altairTypes) => {
  return new ContainerType({
    fields: {
      ...altairTypes.Validator.fields,
      nextCustodySecretToReveal: altairTypes.Uint64,
      allCustodySecretsRevealedEpoch: altairTypes.Epoch,
    },
  });
};

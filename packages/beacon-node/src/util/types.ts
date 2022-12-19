import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";

// Misc SSZ types used only in the beacon-node package, no need to upstream to types

export type SignedBLSToExecutionChangeVersioned = ValueOf<typeof signedBLSToExecutionChangeVersionedType>;
export const signedBLSToExecutionChangeVersionedType = new ContainerType(
  {
    data: ssz.capella.SignedBLSToExecutionChange,
    signatureEpoch: ssz.Epoch,
  },
  {jsonCase: "eth2", typeName: "SignedBLSToExecutionChangeVersionedType"}
);

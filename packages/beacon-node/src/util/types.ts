import {ContainerType, ListCompositeType, ValueOf} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";

// Misc SSZ types used only in the beacon-node package, no need to upstream to types

export const signedBLSToExecutionChangeVersionedType = new ContainerType(
  {
    // Assumes less than 256 forks, sounds reasonable in our lifetime
    preCapella: ssz.Boolean,
    data: ssz.capella.SignedBLSToExecutionChange,
  },
  {jsonCase: "eth2", typeName: "SignedBLSToExecutionChangeVersionedType"}
);
export type SignedBLSToExecutionChangeVersioned = ValueOf<typeof signedBLSToExecutionChangeVersionedType>;

export const BlobSidecarsByRootRequestType = (fork: ForkName, config: BeaconConfig) =>
  new ListCompositeType(ssz.deneb.BlobIdentifier, config.getMaxRequestBlobSidecars(fork));
export type BlobSidecarsByRootRequest = ValueOf<ReturnType<typeof BlobSidecarsByRootRequestType>>;

import {Epoch, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";

export interface ILatestMessage {
  epoch: Epoch;
  root: Root;
}

/**
 * Used for queuing attestations from the current slot. Only contains the minimum necessary
 * information about the attestation.
 */
export interface IQueuedAttestation {
  slot: Slot;
  attestingIndices: ValidatorIndex[];
  blockRoot: Uint8Array;
  targetEpoch: Epoch;
}

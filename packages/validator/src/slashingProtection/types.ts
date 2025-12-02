import {Epoch, Root, Slot} from "@lodestar/types";

export interface SlashingProtectionBlock {
  slot: Slot;
  signingRoot: Root;
}

export interface SlashingProtectionAttestation {
  sourceEpoch: Epoch;
  targetEpoch: Epoch;
  signingRoot: Root;
}

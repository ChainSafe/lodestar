import {Epoch, Root, Slot} from "@chainsafe/lodestar-types";

/* eslint-disable @typescript-eslint/naming-convention */

export interface SlashingProtectionBlock {
  slot: Slot;
  signingRoot: Root;
}

export interface SlashingProtectionAttestation {
  sourceEpoch: Epoch;
  targetEpoch: Epoch;
  signingRoot: Root;
}

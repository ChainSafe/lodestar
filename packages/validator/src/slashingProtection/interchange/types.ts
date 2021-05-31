import {BLSPubkey, Root, phase0} from "@chainsafe/lodestar-types";
import {IInterchangeCompleteV4} from "./formats/completeV4";
import {IInterchangeV5} from "./formats/v5";

export type Interchange = IInterchangeV5 | IInterchangeCompleteV4;

// `format` only for version < v5.0.0
export type InterchangeFormatVersion = {format?: "complete"; version: "4" | "5"};

export interface IInterchangeLodestar {
  genesisValidatorsRoot: Root;
  data: {
    pubkey: BLSPubkey;
    signedBlocks: phase0.SlashingProtectionBlock[];
    signedAttestations: phase0.SlashingProtectionAttestation[];
  }[];
}

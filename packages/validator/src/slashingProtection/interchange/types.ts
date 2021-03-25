import {BLSPubkey, Root, phase0} from "@chainsafe/lodestar-types";
import {IInterchangeCompleteV4} from "./formats/completeV4";

export type Interchange = IInterchangeCompleteV4;

export type InterchangeFormatVersion = {format: "complete"; version: "4"};

export interface IInterchangeLodestar {
  genesisValidatorsRoot: Root;
  data: {
    pubkey: BLSPubkey;
    signedBlocks: phase0.SlashingProtectionBlock[];
    signedAttestations: phase0.SlashingProtectionAttestation[];
  }[];
}

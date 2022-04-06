import {BLSPubkey, Root} from "@chainsafe/lodestar-types";
import {SlashingProtectionAttestation, SlashingProtectionBlock} from "../types.js";
import {IInterchangeCompleteV4} from "./formats/completeV4.js";
import {IInterchangeV5} from "./formats/v5.js";

export type Interchange = IInterchangeV5 | IInterchangeCompleteV4;

// `format` only for version < v5.0.0
export type InterchangeFormatVersion = {format?: "complete"; version: "4" | "5"};

export interface IInterchangeLodestar {
  genesisValidatorsRoot: Root;
  data: {
    pubkey: BLSPubkey;
    signedBlocks: SlashingProtectionBlock[];
    signedAttestations: SlashingProtectionAttestation[];
  }[];
}

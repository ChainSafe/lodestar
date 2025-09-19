import {BLSPubkey, Root} from "@lodestar/types";
import {SlashingProtectionAttestation, SlashingProtectionBlock} from "../types.js";
import {InterchangeCompleteV4} from "./formats/completeV4.js";
import {InterchangeV5} from "./formats/v5.js";

export type Interchange = InterchangeV5 | InterchangeCompleteV4;

// `format` only for version < v5.0.0
export type InterchangeFormatVersion = {format?: "complete"; version: "4" | "5"};

export type InterchangeLodestar = {
  genesisValidatorsRoot: Root;
  data: {
    pubkey: BLSPubkey;
    signedBlocks: SlashingProtectionBlock[];
    signedAttestations: SlashingProtectionAttestation[];
  }[];
};

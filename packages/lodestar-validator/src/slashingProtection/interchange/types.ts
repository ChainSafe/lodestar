import {BLSPubkey, Root, SlashingProtectionAttestation, SlashingProtectionBlock} from "@chainsafe/lodestar-types";

export interface IInterchangeLodestar {
  genesisValidatorsRoot: Root;
  data: {
    pubkey: BLSPubkey;
    signedBlocks: SlashingProtectionBlock[];
    signedAttestations: SlashingProtectionAttestation[];
  }[];
}

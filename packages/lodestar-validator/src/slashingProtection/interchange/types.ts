import {BLSPubkey, Epoch, Root, Slot} from "@chainsafe/lodestar-types";

/* eslint-disable @typescript-eslint/interface-name-prefix */

/**
 * For validator slashing protection
 */
interface SlashingProtectionBlock {
  slot: Slot;
  signingRoot: Root;
}

/**
 * For validator slashing protection
 */
interface SlashingProtectionAttestation {
  sourceEpoch: Epoch;
  targetEpoch: Epoch;
  signingRoot: Root;
}

export interface IInterchangeLodestar {
  genesisValidatorsRoot: Root;
  data: {
    pubkey: BLSPubkey;
    signedBlocks: SlashingProtectionBlock[];
    signedAttestations: SlashingProtectionAttestation[];
  }[];
}

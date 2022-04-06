/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IInterchangeLodestar} from "../types.js";
import {fromOptionalHexString, numToString, toOptionalHexString} from "../../utils.js";

/**
 * A complete record of all blocks and attestations signed by a set of validators
 * Spec from: https://eips.ethereum.org/EIPS/eip-3076
 */
export interface IInterchangeV5 {
  metadata: {
    interchange_format_version: "5";
    /**
     * ```
     * "0x04700007fabc8282644aed6d1c7c9e21d38a03a0c4ba193f3afe428824b3a673"
     * ```
     */
    genesis_validators_root: string;
  };
  data: {
    /**
     * pubkey: BLSPubkey is the BLS public key of the validator encoded as 0x-prefixed hex
     * ```
     * "0xb845089a1457f811bfc000588fbb4e713669be8ce060ea6be3c6ece09afc3794106c91ca73acda5e5457122d58723bed"
     * ```
     */
    pubkey: string;
    /**
     * signed_blocks is a list of objects with fields
     */
    signed_blocks: {
      /**
       * slot: Slot, the slot of the block that was signed
       * ```
       * "81952"
       * ```
       */
      slot: string;
      /**
       * signing_root: Root (optional) is compute_signing_root(block, domain), where:
       * - block is the block that was signed as type BeaconBlock or equivalently BeaconBlockHeader
       * - domain is equal to compute_domain(DOMAIN_BEACON_PROPOSER, fork, metadata.genesis_validators_root), where:
       *   - metadata.genesis_validators_root is the genesis_validators_root from this interchange file
       *   - fork: Version is the fork that the block was signed against
       * ```
       * "0x4ff6f743a43f3b4f95350831aeaf0a122a1a392922c45d804280284a69eb850b"
       * ```
       */
      signing_root?: string;
    }[];
    /**
     * signed_attestations is a list of objects with fields
     */
    signed_attestations: {
      /**
       * source_epoch: Epoch, the attestation.data.source.epoch of the signed attestation
       * ```
       * "2290"
       * ```
       */
      source_epoch: string;
      /**
       * target_epoch: Epoch, the attestation.data.target.epoch of the signed attestation
       * ```
       * "3007"
       * ```
       */
      target_epoch: string;
      /**
       * signing_root: Root (optional) is compute_signing_root(attestation, domain), where:
       * - attestation is the attestation that was signed as type AttestationData
       * - domain is equal to compute_domain(DOMAIN_BEACON_ATTESTER, fork, metadata.genesis_validators_root), where:
       *   - metadata.genesis_validators_root is the genesis_validators_root from this interchange file
       *   - fork: Version is the fork that the attestation was signed against
       * ```
       * "0x587d6a4f59a58fe24f406e0502413e77fe1babddee641fda30034ed37ecc884d"
       * ```
       */
      signing_root?: string;
    }[];
  }[];
}

export function serializeInterchangeV5({data, genesisValidatorsRoot}: IInterchangeLodestar): IInterchangeV5 {
  return {
    metadata: {
      interchange_format_version: "5",
      genesis_validators_root: toHexString(genesisValidatorsRoot),
    },
    data: data.map((validator) => ({
      pubkey: toHexString(validator.pubkey),
      signed_blocks: validator.signedBlocks.map((block) => ({
        slot: numToString(block.slot),
        signing_root: toOptionalHexString(block.signingRoot),
      })),
      signed_attestations: validator.signedAttestations.map((att) => ({
        source_epoch: numToString(att.sourceEpoch),
        target_epoch: numToString(att.targetEpoch),
        signing_root: toOptionalHexString(att.signingRoot),
      })),
    })),
  };
}

export function parseInterchangeV5(interchange: IInterchangeV5): IInterchangeLodestar {
  return {
    genesisValidatorsRoot: fromHexString(interchange.metadata.genesis_validators_root),
    data: interchange.data.map((validator) => ({
      pubkey: fromHexString(validator.pubkey),
      signedBlocks: validator.signed_blocks.map((block) => ({
        slot: parseInt(block.slot, 10),
        signingRoot: fromOptionalHexString(block.signing_root),
      })),
      signedAttestations: validator.signed_attestations.map((att) => ({
        sourceEpoch: parseInt(att.source_epoch, 10),
        targetEpoch: parseInt(att.target_epoch, 10),
        signingRoot: fromOptionalHexString(att.signing_root),
      })),
    })),
  };
}

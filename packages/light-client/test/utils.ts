import {SecretKey, Signature} from "@chainsafe/bls";
import {computeDomain, computeSigningRoot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig, createIBeaconConfig} from "@chainsafe/lodestar-config";
import {params as minimalParams} from "@chainsafe/lodestar-params/minimal";
import {altair, Bytes4, Root, Slot} from "@chainsafe/lodestar-types";

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Create extra minimal sync committee config to make tests faster
 */
export function createExtraMinimalConfig(): IBeaconConfig {
  return createIBeaconConfig({
    ...minimalParams,
    SYNC_COMMITTEE_SIZE: 4,
    SYNC_PUBKEYS_PER_AGGREGATE: 2,
  });
}

export function signAndAggregate(message: Uint8Array, sks: SecretKey[]): altair.SyncAggregate {
  const sigs = sks.map((sk) => sk.sign(message));
  const aggSig = Signature.aggregate(sigs).toBytes();
  return {
    syncCommitteeBits: sks.map(() => true),
    syncCommitteeSignature: aggSig,
  };
}

export function getSyncAggregateSigningRoot(
  config: IBeaconConfig,
  genesisValidatorsRoot: Root,
  forkVersion: Bytes4,
  syncAttestedBlockHeader: altair.BeaconBlockHeader
): Uint8Array {
  const domain = computeDomain(config, config.params.DOMAIN_SYNC_COMMITTEE, forkVersion, genesisValidatorsRoot);
  return computeSigningRoot(config, config.types.altair.BeaconBlockHeader, syncAttestedBlockHeader, domain);
}

export function defaultBeaconBlockHeader(config: IBeaconConfig, slot: Slot): altair.BeaconBlockHeader {
  const header = config.types.altair.BeaconBlockHeader.defaultValue();
  header.slot = slot;
  return header;
}

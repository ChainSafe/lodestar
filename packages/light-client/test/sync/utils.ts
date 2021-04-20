import {SecretKey, Signature} from "@chainsafe/bls";
import {computeDomain, computeSigningRoot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, Root, Slot} from "@chainsafe/lodestar-types";

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
  syncAttestedBlockHeader: altair.BeaconBlockHeader
): Uint8Array {
  const fork = config.types.altair.Fork.defaultValue();
  const domain = computeDomain(config, config.params.DOMAIN_SYNC_COMMITTEE, fork.currentVersion, genesisValidatorsRoot);
  return computeSigningRoot(config, config.types.altair.BeaconBlockHeader, syncAttestedBlockHeader, domain);
}

export function defaultBeaconBlockHeader(config: IBeaconConfig, slot: Slot): altair.BeaconBlockHeader {
  const header = config.types.altair.BeaconBlockHeader.defaultValue();
  header.slot = slot;
  return header;
}

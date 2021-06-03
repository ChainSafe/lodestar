import {aggregatePublicKeys, PublicKey, SecretKey, Signature} from "@chainsafe/bls";
import {computeDomain, computeSigningRoot, interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/default";
import {DOMAIN_SYNC_COMMITTEE, SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {altair, Bytes4, Gwei, Root, Slot, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {fromHexString, List} from "@chainsafe/ssz";
import {SyncCommitteeFast} from "../src/client/types";

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Create extra minimal sync committee config to make tests faster
 */
export function createExtraMinimalConfig(): IBeaconConfig {
  return config;
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
  const domain = computeDomain(DOMAIN_SYNC_COMMITTEE, forkVersion, genesisValidatorsRoot);
  return computeSigningRoot(ssz.phase0.BeaconBlockHeader, syncAttestedBlockHeader, domain);
}

export function defaultBeaconBlockHeader(config: IBeaconConfig, slot: Slot): altair.BeaconBlockHeader {
  const header = ssz.phase0.BeaconBlockHeader.defaultValue();
  header.slot = slot;
  return header;
}

export type SyncCommitteeKeys = {
  sks: SecretKey[];
  pks: PublicKey[];
  syncCommittee: altair.SyncCommittee;
  syncCommitteeFast: SyncCommitteeFast;
};

export function getInteropSyncCommittee(config: IBeaconConfig, period: SyncPeriod): SyncCommitteeKeys {
  const fromIndex = period * SYNC_COMMITTEE_SIZE;
  const toIndex = (period + 1) * SYNC_COMMITTEE_SIZE;
  const sks: SecretKey[] = [];
  for (let i = fromIndex; i < toIndex; i++) {
    sks.push(interopSecretKey(i));
  }
  const pks = sks.map((sk) => sk.toPublicKey());
  const pubkeys = pks.map((pk) => pk.toBytes());
  return {
    sks,
    pks,
    syncCommittee: {
      pubkeys,
      aggregatePubkey: aggregatePublicKeys(pubkeys),
    },
    syncCommitteeFast: {
      pubkeys: pks,
      aggregatePubkey: PublicKey.fromBytes(aggregatePublicKeys(pubkeys)),
    },
  };
}

/**
 * Generates a single fake validator, for tests purposes only.
 */
export function generateValidator(opts: Partial<altair.Validator> = {}): altair.Validator {
  return {
    pubkey: fromHexString(
      // randomly pregenerated pubkey
      "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576"
    ),
    withdrawalCredentials: Buffer.alloc(32),
    activationEpoch: 0,
    activationEligibilityEpoch: 10000,
    exitEpoch: 10000,
    withdrawableEpoch: 10000,
    slashed: opts.slashed || false,
    effectiveBalance: BigInt(32),
    ...opts,
  };
}

/**
 * Generates n number of validators, for tests purposes only.
 */
export function generateValidators(n: number, opts?: Partial<altair.Validator>): List<altair.Validator> {
  return Array.from({length: n}, () => generateValidator(opts)) as List<altair.Validator>;
}

export function generateBalances(n: number): List<Gwei> {
  return Array.from({length: n}, () => BigInt(32000000000)) as List<Gwei>;
}

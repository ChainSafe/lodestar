import {PointFormat, PublicKey, SecretKey, Signature} from "@chainsafe/bls";
import {computeDomain, computeSigningRoot, interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {DOMAIN_SYNC_COMMITTEE, SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {altair, Bytes4, phase0, Root, Slot, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {fromHexString, List} from "@chainsafe/ssz";
import {SyncCommitteeFast} from "../src/client/types";

/* eslint-disable @typescript-eslint/naming-convention */

export function signAndAggregate(message: Uint8Array, sks: SecretKey[]): altair.SyncAggregate {
  const sigs = sks.map((sk) => sk.sign(message));
  const aggSig = Signature.aggregate(sigs).toBytes();
  return {
    syncCommitteeBits: sks.map(() => true),
    syncCommitteeSignature: aggSig,
  };
}

export function getSyncAggregateSigningRoot(
  genesisValidatorsRoot: Root,
  forkVersion: Bytes4,
  syncAttestedBlockHeader: phase0.BeaconBlockHeader
): Uint8Array {
  const domain = computeDomain(DOMAIN_SYNC_COMMITTEE, forkVersion, genesisValidatorsRoot);
  return computeSigningRoot(ssz.phase0.BeaconBlockHeader, syncAttestedBlockHeader, domain);
}

export function defaultBeaconBlockHeader(slot: Slot): phase0.BeaconBlockHeader {
  const header = ssz.phase0.BeaconBlockHeader.defaultValue();
  header.slot = slot;
  return header;
}

export type SyncCommitteeKeys = {
  pks: PublicKey[];
  syncCommittee: altair.SyncCommittee;
  syncCommitteeFast: SyncCommitteeFast;
  signAndAggregate: (message: Uint8Array) => altair.SyncAggregate;
};

/**
 * To make the test fast each sync committee has a single key repeated `SYNC_COMMITTEE_SIZE` times
 */
export function getInteropSyncCommittee(period: SyncPeriod): SyncCommitteeKeys {
  const sk = interopSecretKey(period);
  const pk = sk.toPublicKey();
  const pks = Array.from({length: SYNC_COMMITTEE_SIZE}, () => pk);

  const pkBytes = pk.toBytes(PointFormat.compressed);
  const pksBytes = Array.from({length: SYNC_COMMITTEE_SIZE}, () => pkBytes);

  const aggPk = PublicKey.aggregate(pks);

  function signAndAggregate(message: Uint8Array): altair.SyncAggregate {
    const sig = sk.sign(message);
    const sigs = Array.from({length: SYNC_COMMITTEE_SIZE}, () => sig);
    const aggSig = Signature.aggregate(sigs).toBytes();
    return {
      syncCommitteeBits: Array.from({length: SYNC_COMMITTEE_SIZE}, () => true),
      syncCommitteeSignature: aggSig,
    };
  }

  return {
    pks,
    signAndAggregate,
    syncCommittee: {
      pubkeys: pksBytes,
      aggregatePubkey: aggPk.toBytes(PointFormat.compressed),
    },
    syncCommitteeFast: {
      pubkeys: pks,
      aggregatePubkey: aggPk,
    },
  };
}

/**
 * Generates a single fake validator, for tests purposes only.
 */
export function generateValidator(opts: Partial<phase0.Validator> = {}): phase0.Validator {
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
    effectiveBalance: 32,
    ...opts,
  };
}

/**
 * Generates n number of validators, for tests purposes only.
 */
export function generateValidators(n: number, opts?: Partial<phase0.Validator>): List<phase0.Validator> {
  return Array.from({length: n}, () => generateValidator(opts)) as List<phase0.Validator>;
}

export function generateBalances(n: number): List<number> {
  return Array.from({length: n}, () => 32e9) as List<number>;
}

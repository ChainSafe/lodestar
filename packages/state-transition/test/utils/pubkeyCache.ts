import {expect} from "vitest";
import {BeaconConfig} from "@lodestar/config";
import {SecretKey} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {DOMAIN_DEPOSIT, FAR_FUTURE_EPOCH, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {
  PubkeyCacheState,
  getStateValidatorCount,
  getValidatorIndex,
  getValidatorPubkeyBytes,
} from "../../src/cache/pubkeyCache.js";
import {BeaconStateAllForks, BeaconStateFulu, BeaconStateGloas} from "../../src/cache/types.js";
import {ZERO_HASH} from "../../src/constants/index.js";
import {computeDomain} from "../../src/util/domain.js";
import {interopSecretKey} from "../../src/util/interop.js";
import {computeSigningRoot} from "../../src/util/signingRoot.js";

export const finalizedValidatorCount = 64;
export const forkEpoch = 4;
export const genesisRoot = Buffer.alloc(32, 0xaa);
export const keyA = interopSecretKey(1000);
export const keyB = interopSecretKey(1001);

function withdrawalCredentials(prefix: number, fill: number): Uint8Array {
  const credentials = Buffer.alloc(32);
  credentials[0] = prefix;
  credentials.fill(fill, 12);
  return credentials;
}

export function createFuluState(config: BeaconConfig, slot: number): BeaconStateFulu {
  const state = ssz.fulu.BeaconState.defaultViewDU();
  state.genesisValidatorsRoot = genesisRoot;
  state.slot = slot;
  state.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: config.FULU_FORK_VERSION,
    currentVersion: config.FULU_FORK_VERSION,
    epoch: 0,
  });
  const pubkeys: Uint8Array[] = [];
  for (let i = 0; i < finalizedValidatorCount; i++) {
    const pubkey = interopSecretKey(i).toPublicKey().toBytes();
    pubkeys.push(pubkey);
    state.validators.push(
      ssz.phase0.Validator.toViewDU({
        ...ssz.phase0.Validator.defaultValue(),
        pubkey,
        withdrawalCredentials: withdrawalCredentials(0x01, i),
        effectiveBalance: 32e9,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );
    state.balances.push(32e9);
    state.inactivityScores.push(0);
    state.previousEpochParticipation.push(0);
    state.currentEpochParticipation.push(0);
  }
  const syncCommittee = {
    pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => pubkeys[i % finalizedValidatorCount]),
    aggregatePubkey: pubkeys[0],
  };
  state.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);
  state.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);
  for (const key of ["finalizedCheckpoint", "currentJustifiedCheckpoint", "previousJustifiedCheckpoint"] as const) {
    state[key] = ssz.phase0.Checkpoint.toViewDU({epoch: forkEpoch - 2, root: Buffer.alloc(32, 1)});
  }
  state.commit();
  return state;
}

export function addDeposits(
  state: Pick<BeaconStateFulu | BeaconStateGloas, "validators" | "pendingDeposits">,
  config: BeaconConfig,
  churn: number,
  prefix: number
): void {
  const deposits = [
    {
      pubkey: state.validators.getReadonly(0).pubkey,
      withdrawalCredentials: withdrawalCredentials(0x01, 0),
      amount: churn,
      signature: Buffer.alloc(96),
      slot: 1,
    },
    signedDeposit(config, keyA, prefix, prefix === 0xb0 ? 5e9 : 32e9),
    signedDeposit(config, keyB, 0x01, 32e9),
  ];
  for (const deposit of deposits) {
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
  }
}

export function slashFirstValidator(state: Pick<BeaconStateAllForks, "validators">): void {
  const validator = state.validators.get(0);
  validator.slashed = true;
  validator.exitEpoch = forkEpoch + 1;
  validator.withdrawableEpoch = forkEpoch + 100;
}

function signedDeposit(config: BeaconConfig, key: SecretKey, prefix: number, amount: number): electra.PendingDeposit {
  const message = {
    pubkey: key.toPublicKey().toBytes(),
    withdrawalCredentials: withdrawalCredentials(prefix, prefix + 1),
    amount,
  };
  const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
  const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, message, domain);
  return {...message, signature: key.sign(signingRoot).toBytes(), slot: 1};
}

export function orderBranches<T>(
  order: "side first" | "canonical first",
  side: () => T,
  canonical: () => T
): {side: T; canonical: T} {
  return order === "side first" ? {side: side(), canonical: canonical()} : {canonical: canonical(), side: side()};
}

export function expectBranchIndices(
  side: PubkeyCacheState,
  canonical: PubkeyCacheState,
  canonicalA: number | null,
  canonicalB: number
): void {
  const pubkeyA = keyA.toPublicKey().toBytes();
  const pubkeyB = keyB.toPublicKey().toBytes();
  expect(getStateValidatorCount(side)).toBe(finalizedValidatorCount + 2);
  expect(getStateValidatorCount(canonical)).toBe(canonicalB + 1);
  expect(getValidatorIndex(pubkeyCache, side, pubkeyA)).toBe(finalizedValidatorCount);
  expect(getValidatorIndex(pubkeyCache, side, pubkeyB)).toBe(finalizedValidatorCount + 1);
  expect(getValidatorIndex(pubkeyCache, canonical, pubkeyA)).toBe(canonicalA);
  expect(getValidatorIndex(pubkeyCache, canonical, pubkeyB)).toBe(canonicalB);
  expect(getValidatorPubkeyBytes(pubkeyCache, canonical, canonicalB)).toEqual(pubkeyB);
  expect(pubkeyCache.size).toBe(finalizedValidatorCount);
  expect(pubkeyCache.getIndex(pubkeyA)).toBeNull();
  expect(pubkeyCache.getIndex(pubkeyB)).toBeNull();
}

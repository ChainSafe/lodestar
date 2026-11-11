import {
  DOMAIN_PREREGISTRATION,
  PREREGISTRATIONS_LIMIT,
  PREREGISTRATION_EXPIRY_SLOTS,
  RESERVED_LEAF_PREREGISTRATION,
} from "@lodestar/params";
import {pq, ssz} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {CachedBeaconStatePq} from "../types.js";
import {computeDomain} from "../util/domain.js";
import {computeDepositPubkey, verifyXmss} from "../util/pq.js";
import {computeSigningRoot} from "../util/signingRoot.js";

/** A preregistration is in force until the parent payload, whose requests a block applies, reaches its expiry slot */
function isActive(state: CachedBeaconStatePq, preregistration: pq.StoredPreregistration): boolean {
  return state.latestExecutionPayloadBid.slot < preregistration.expirySlot;
}

function getStoredIndex(state: CachedBeaconStatePq, pubkey: pq.XMSSPubkey): number | null {
  state.validatorPreregistrations.commit();
  const stored = state.validatorPreregistrations.getAllReadonlyValues();
  for (let i = 0; i < stored.length; i++) {
    if (byteArrayEquals(stored[i].pubkey, pubkey)) return i;
  }
  return null;
}

/** The unexpired preregistration of `pubkey`, if any */
export function getActivePreregistration(
  state: CachedBeaconStatePq,
  pubkey: pq.XMSSPubkey
): pq.StoredPreregistration | null {
  const index = getStoredIndex(state, pubkey);
  if (index === null) return null;
  const preregistration = state.validatorPreregistrations.getReadonly(index).toValue();
  return isActive(state, preregistration) ? preregistration : null;
}

function retain(state: CachedBeaconStatePq, keep: (preregistration: pq.StoredPreregistration) => boolean): void {
  state.validatorPreregistrations.commit();
  const stored = state.validatorPreregistrations.getAllReadonlyValues();
  const kept = stored.filter(keep);
  if (kept.length !== stored.length) {
    state.validatorPreregistrations = ssz.pq.ValidatorPreregistrations.toViewDU(kept);
  }
}

export function removeStoredPreregistration(state: CachedBeaconStatePq, pubkey: pq.XMSSPubkey): void {
  retain(state, (preregistration) => !byteArrayEquals(preregistration.pubkey, pubkey));
}

/** Drops expired preregistrations. They were already unenforced. */
export function processPreregistrationExpiry(state: CachedBeaconStatePq): void {
  retain(state, (preregistration) => isActive(state, preregistration));
}

function isPendingValidator(state: CachedBeaconStatePq, pubkey: pq.XMSSPubkey): boolean {
  state.pendingDeposits.commit();
  for (const deposit of state.pendingDeposits.getAllReadonlyValues()) {
    if (byteArrayEquals(computeDepositPubkey(deposit.pubkey), pubkey)) return true;
  }
  return false;
}

/**
 * Binds a new public key to withdrawal credentials and a VRF root, so that nobody else can deposit
 * for it first.
 *
 * Its signature is always checked here: a request with an invalid one is ignored, so no verifier
 * outside the state transition can stand in.
 */
export function processPreregistrationRequest(state: CachedBeaconStatePq, request: pq.PreregistrationRequest): void {
  const {pubkey} = request;

  if (getActivePreregistration(state, pubkey) !== null) return;
  if (state.epochCtx.getValidatorIndex(pubkey) !== null) return;
  if (isPendingValidator(state, pubkey)) return;

  state.validatorPreregistrations.commit();
  const stored = state.validatorPreregistrations.getAllReadonlyValues();
  let active = 0;
  for (const preregistration of stored) {
    if (isActive(state, preregistration)) active++;
  }
  if (active >= PREREGISTRATIONS_LIMIT) return;

  const domain = computeDomain(DOMAIN_PREREGISTRATION, state.config.GENESIS_FORK_VERSION, state.genesisValidatorsRoot);
  const signingRoot = computeSigningRoot(
    ssz.pq.ValidatorPreregistration,
    {pubkey, withdrawalCredentials: request.withdrawalCredentials, vrfRoot: request.vrfRoot},
    domain
  );
  if (!verifyXmss(pubkey, RESERVED_LEAF_PREREGISTRATION, signingRoot, request.signature)) return;

  const preregistration = ssz.pq.StoredPreregistration.toViewDU({
    pubkey,
    withdrawalCredentials: request.withdrawalCredentials,
    vrfRoot: request.vrfRoot,
    expirySlot: state.slot + PREREGISTRATION_EXPIRY_SLOTS,
  });
  const index = getStoredIndex(state, pubkey);
  if (index !== null) {
    state.validatorPreregistrations.set(index, preregistration);
  } else {
    state.validatorPreregistrations.push(preregistration);
  }
}

import {PREREGISTRATIONS_LIMIT, PREREGISTRATION_EXPIRY_SLOTS} from "@lodestar/params";
import {pq, ssz} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {CachedBeaconStatePq} from "../types.js";
import {computeDepositPubkey} from "../util/pq.js";

// A preregistration binds a new public key to withdrawal credentials, and for a validator to a VRF
// root, so that nobody else can deposit for it first. The system contract verifies the key's
// signature before it emits the request.

type Preregistration = pq.ValidatorPreregistration | pq.BuilderPreregistration;
type Kind = "validator" | "builder";
type Stored<K extends Kind> = K extends "validator" ? pq.ValidatorPreregistration : pq.BuilderPreregistration;

function getList(state: CachedBeaconStatePq, kind: Kind) {
  const list = kind === "validator" ? state.validatorPreregistrations : state.builderPreregistrations;
  list.commit();
  return list;
}

/** A preregistration is in force until the parent payload, whose requests a block applies, reaches its expiry slot */
function isActive(state: CachedBeaconStatePq, preregistration: Preregistration): boolean {
  return state.latestExecutionPayloadBid.slot < preregistration.expirySlot;
}

function getStoredIndex(state: CachedBeaconStatePq, kind: Kind, pubkey: pq.XMSSPubkey): number | null {
  const stored = getList(state, kind).getAllReadonlyValues();
  for (let i = 0; i < stored.length; i++) {
    if (byteArrayEquals(stored[i].pubkey, pubkey)) return i;
  }
  return null;
}

/** The unexpired preregistration of `pubkey`, if any */
export function getActivePreregistration<K extends Kind>(
  state: CachedBeaconStatePq,
  kind: K,
  pubkey: pq.XMSSPubkey
): Stored<K> | null {
  const index = getStoredIndex(state, kind, pubkey);
  if (index === null) return null;
  const preregistration = getList(state, kind).getReadonly(index).toValue();
  return isActive(state, preregistration) ? (preregistration as Stored<K>) : null;
}

function retain(state: CachedBeaconStatePq, kind: Kind, keep: (preregistration: Preregistration) => boolean): void {
  const stored = getList(state, kind).getAllReadonlyValues();
  const kept = stored.filter(keep);
  if (kept.length === stored.length) return;
  if (kind === "validator") {
    state.validatorPreregistrations = ssz.pq.ValidatorPreregistrations.toViewDU(kept as pq.ValidatorPreregistration[]);
  } else {
    state.builderPreregistrations = ssz.pq.BuilderPreregistrations.toViewDU(kept);
  }
}

export function removePreregistration(state: CachedBeaconStatePq, kind: Kind, pubkey: pq.XMSSPubkey): void {
  retain(state, kind, (preregistration) => !byteArrayEquals(preregistration.pubkey, pubkey));
}

/** Drops expired preregistrations. They were already unenforced. */
export function processPreregistrationExpiry(state: CachedBeaconStatePq): void {
  retain(state, "validator", (preregistration) => isActive(state, preregistration));
  retain(state, "builder", (preregistration) => isActive(state, preregistration));
}

function isPendingValidator(state: CachedBeaconStatePq, pubkey: pq.XMSSPubkey): boolean {
  state.pendingDeposits.commit();
  for (const deposit of state.pendingDeposits.getAllReadonlyValues()) {
    if (byteArrayEquals(computeDepositPubkey(deposit.pubkey), pubkey)) return true;
  }
  return false;
}

/** Whether another binding fits: the limit counts active records, so the sweep's timing does not matter */
function hasCapacity(state: CachedBeaconStatePq, kind: Kind): boolean {
  let active = 0;
  for (const preregistration of getList(state, kind).getAllReadonlyValues()) {
    if (isActive(state, preregistration)) active++;
  }
  return active < PREREGISTRATIONS_LIMIT;
}

export function processValidatorPreregistrationRequest(
  state: CachedBeaconStatePq,
  request: pq.ValidatorPreregistrationRequest
): void {
  const {pubkey} = request;

  if (getActivePreregistration(state, "validator", pubkey) !== null) return;
  // The pubkey cache is shared between states: only an index inside this state's registry counts
  const validatorIndex = state.epochCtx.getValidatorIndex(pubkey);
  if (validatorIndex !== null && validatorIndex < state.validators.length) return;
  if (isPendingValidator(state, pubkey)) return;
  if (!hasCapacity(state, "validator")) return;

  const preregistration = ssz.pq.ValidatorPreregistration.toViewDU({
    pubkey,
    withdrawalCredentials: request.withdrawalCredentials,
    vrfRoot: request.vrfRoot,
    expirySlot: state.slot + PREREGISTRATION_EXPIRY_SLOTS,
  });
  // An expired record of the key is replaced in place
  const index = getStoredIndex(state, "validator", pubkey);
  if (index !== null) {
    state.validatorPreregistrations.set(index, preregistration);
  } else {
    state.validatorPreregistrations.push(preregistration);
  }
}

export function processBuilderPreregistrationRequest(
  state: CachedBeaconStatePq,
  request: pq.BuilderPreregistrationRequest
): void {
  const {pubkey} = request;

  if (getActivePreregistration(state, "builder", pubkey) !== null) return;
  state.builders.commit();
  for (const builder of state.builders.getAllReadonlyValues()) {
    if (byteArrayEquals(builder.pubkey, pubkey)) return;
  }
  if (!hasCapacity(state, "builder")) return;

  const preregistration = ssz.pq.BuilderPreregistration.toViewDU({
    pubkey,
    withdrawalCredentials: request.withdrawalCredentials,
    expirySlot: state.slot + PREREGISTRATION_EXPIRY_SLOTS,
  });
  const index = getStoredIndex(state, "builder", pubkey);
  if (index !== null) {
    state.builderPreregistrations.set(index, preregistration);
  } else {
    state.builderPreregistrations.push(preregistration);
  }
}

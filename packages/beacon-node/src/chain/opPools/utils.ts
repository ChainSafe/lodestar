import {Signature} from "@chainsafe/lodestar-z/blst";
import {BeaconConfig} from "@lodestar/config";
import {DbBatch, Id, Repository} from "@lodestar/db";
import {BLS_WITHDRAWAL_PREFIX, DOMAIN_BEACON_ATTESTER, DOMAIN_BEACON_PROPOSER} from "@lodestar/params";
import {IBeaconStateView, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {AttesterSlashing, Domain, Slot, capella, phase0} from "@lodestar/types";
import {AggregateFast, AggregateFastElectra} from "./attestationPool.js";

export function getProposerSlashingSignatureDomain(
  config: BeaconConfig,
  stateSlot: Slot,
  slashing: phase0.ProposerSlashing
): Domain {
  return config.getDomain(stateSlot, DOMAIN_BEACON_PROPOSER, Number(slashing.signedHeader1.message.slot));
}

export function getAttesterSlashingSignatureDomains(
  config: BeaconConfig,
  stateSlot: Slot,
  slashing: AttesterSlashing
): [Domain, Domain] {
  return [
    config.getDomain(
      stateSlot,
      DOMAIN_BEACON_ATTESTER,
      computeStartSlotAtEpoch(Number(slashing.attestation1.data.target.epoch))
    ),
    config.getDomain(
      stateSlot,
      DOMAIN_BEACON_ATTESTER,
      computeStartSlotAtEpoch(Number(slashing.attestation2.data.target.epoch))
    ),
  ];
}

/**
 * Prune a Map indexed by slot to keep the most recent slots, up to `slotsRetained`
 */
export function pruneBySlot(map: Map<Slot, unknown>, slot: Slot, slotsRetained: Slot): Slot {
  const lowestPermissibleSlot = Math.max(slot - slotsRetained, 0);

  // No need to prune if the lowest permissible slot has not changed and the queue length is less than the maximum
  if (map.size <= slotsRetained) {
    return lowestPermissibleSlot;
  }

  // Remove the oldest slots to keep a max of `slotsRetained` slots
  const slots = Array.from(map.keys());
  const slotsToDelete = slots.sort((a, b) => b - a).slice(slotsRetained);
  for (const slot of slotsToDelete) {
    map.delete(slot);
  }

  return lowestPermissibleSlot;
}

/**
 * De-serialize bytes into Signature.
 * No need to verify Signature is valid, already run sig-verify = false
 */
export function signatureFromBytesNoCheck(signature: Uint8Array): Signature {
  return Signature.fromBytes(signature);
}

/**
 * Ensures that a SignedBLSToExecutionChange object is _still_ valid for block inclusion. An object valid for the pool,
 * can become invalid for certain forks.
 */
export function isValidBlsToExecutionChangeForBlockInclusion(
  state: IBeaconStateView,
  signedBLSToExecutionChange: capella.SignedBLSToExecutionChange
): boolean {
  // For each condition from https://github.com/ethereum/consensus-specs/blob/v1.6.1/specs/capella/beacon-chain.md#new-process_bls_to_execution_change
  //
  // 1. assert address_change.validator_index < len(state.validators):
  //    If valid before will always be valid in the future, no need to check
  //
  // 2. assert validator.withdrawal_credentials[:1] == BLS_WITHDRAWAL_PREFIX:
  //    Must be checked again, since it can already be changed by now.
  const validator = state.getValidator(signedBLSToExecutionChange.message.validatorIndex);
  const {withdrawalCredentials} = validator;
  if (withdrawalCredentials[0] !== BLS_WITHDRAWAL_PREFIX) {
    return false;
  }

  // 3. assert validator.withdrawal_credentials[1:] == hash(address_change.from_bls_pubkey)[1:]:
  //    If valid before will always be valid in the future, no need to check

  return true;
}

export function isElectraAggregate(aggregate: AggregateFast): aggregate is AggregateFastElectra {
  return (aggregate as AggregateFastElectra).committeeBits !== undefined;
}

/**
 * Persist target items `items` in `dbRepo` doing minimum put and delete writes.
 * Reads all keys in repository to compute the diff between current persisted data and target data.
 */
export async function persistDiff<K extends Id, V>(
  dbRepo: Repository<K, V>,
  items: {key: K; value: V}[],
  serializeKey: (key: K) => number | string,
  opts: {updateExisting?: boolean} = {}
): Promise<void> {
  const persistedKeys = await dbRepo.keys();
  const batch: DbBatch<K, V> = [];

  const persistedKeysSerialized = new Set(persistedKeys.map(serializeKey));
  for (const item of items) {
    if (opts.updateExisting || !persistedKeysSerialized.has(serializeKey(item.key))) {
      batch.push({type: "put", key: item.key, value: item.value});
    }
  }

  const targetKeysSerialized = new Set(items.map((item) => serializeKey(item.key)));
  for (const persistedKey of persistedKeys) {
    if (!targetKeysSerialized.has(serializeKey(persistedKey))) {
      batch.push({type: "del", key: persistedKey});
    }
  }

  if (batch.length > 0) await dbRepo.batch(batch);
}

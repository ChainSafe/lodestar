import {BeaconStateAllForks, computeSlotsSinceEpochStart} from "@chainsafe/lodestar-beacon-state-transition";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {BLSPubkey, CommitteeIndex, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";

export function computeSubnetForCommitteesAtSlot(
  slot: Slot,
  committeesAtSlot: number,
  committeeIndex: CommitteeIndex
): number {
  const slotsSinceEpochStart = computeSlotsSinceEpochStart(slot);
  const committeesSinceEpochStart = committeesAtSlot * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}

/**
 * Precompute all pubkeys for given `validatorIndices`. Ensures that all `validatorIndices` are known
 * before doing other expensive logic.
 *
 * Uses special BranchNodeStruct state.validators data structure to optimize getting pubkeys.
 * Type-unsafe: assumes state.validators[i] is of BranchNodeStruct type.
 * Note: This is the fastest way of getting compressed pubkeys.
 *       See benchmark -> packages/lodestar/test/perf/api/impl/validator/attester.test.ts
 */
export function getPubkeysForIndices(
  validators: BeaconStateAllForks["validators"],
  indexes: ValidatorIndex[]
): BLSPubkey[] {
  const validatorsLen = validators.length; // Get once, it's expensive

  const pubkeys: BLSPubkey[] = [];
  for (let i = 0, len = indexes.length; i < len; i++) {
    const index = indexes[i];
    if (index >= validatorsLen) {
      throw Error(`validatorIndex ${index} too high. Current validator count ${validatorsLen}`);
    }

    // NOTE: This could be optimized further by traversing the tree optimally with .getNodes()
    const validator = validators.getReadonly(index);
    pubkeys.push(validator.pubkey);
  }

  return pubkeys;
}

import {
  computeSubnetForAttestation,
  getAttestingIndices,
  getCurrentSlot, getIndexedAttestation, isValidIndexedAttestation,
  processSlots
} from "@chainsafe/lodestar-beacon-state-transition";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../constants";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation, BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db/api";
import {assert} from "@chainsafe/lodestar-utils";

/**
 * is ready to be included in block
 */
export function hasValidAttestationSlot(config: IBeaconConfig, genesisTime: number, attestation: Attestation): boolean {
  const currentSlot = getCurrentSlot(config, genesisTime);
  return attestation.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= currentSlot
      && currentSlot >= attestation.data.slot;
}

export function isUnaggregatedAttestation(
  config: IBeaconConfig, state: BeaconState, attestation: Attestation
): boolean {
  if (state.slot < attestation.data.slot) {
    processSlots(config, state, attestation.data.slot);
  }
  // Make sure this is unaggregated attestation
  return getAttestingIndices(config, state, attestation.data, attestation.aggregationBits).length === 1;
}

export async function isAttestingToValidBlock(db: IBeaconDb, attestation: Attestation): Promise<boolean> {
  const blockRoot = attestation.data.beaconBlockRoot.valueOf() as Uint8Array;
  return await db.block.has(blockRoot);
}

export async function hasValidatorAttestedForThatTargetEpoch(
  config: IBeaconConfig, db: IBeaconDb, state: BeaconState, attestation: Attestation
): Promise<boolean> {
  if (state.slot < attestation.data.slot) {
    processSlots(config, state, attestation.data.slot);
  }
  const existingAttestations = await db.attestation.geAttestationsByTargetEpoch(
    attestation.data.target.epoch
  );
    // each attestation has only 1 validator index
  const existingValidatorIndexes = existingAttestations.map(
    item => getAttestingIndices(config, state, item.data, item.aggregationBits)[0]);
    // attestation is unaggregated attestation as validated above
  const validatorIndex = getAttestingIndices(config, state, attestation.data, attestation.aggregationBits)[0];
  return !existingValidatorIndexes.includes(validatorIndex);
}

export async function validateAttestation(
  config: IBeaconConfig, db: IBeaconDb, state: BeaconState, attestation: Attestation
): Promise<void> {
  if (state.slot < attestation.data.slot) {
    processSlots(config, state, attestation.data.slot);
  }
  // Make sure this is unaggregated attestation
  assert.true(isUnaggregatedAttestation(config, state, attestation), "Attestation is aggregated");
  assert.true(
    await hasValidatorAttestedForThatTargetEpoch(config, db, state, attestation),
    "Validator already attested for that target epoch"
  );
  assert.true(await isAttestingToValidBlock(db, attestation), "Attestation block missing or invalid");
  assert.true(
    isValidIndexedAttestation(config, state, getIndexedAttestation(config, state, attestation)),
    "Invalid indexed attestation (signature/)"
  );
}

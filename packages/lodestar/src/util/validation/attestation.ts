import {
  EpochContext,
  getAttestingIndicesFromCommittee,
  getCurrentSlot,
  getIndexedAttestation,
  isValidIndexedAttestation
} from "@chainsafe/lodestar-beacon-state-transition";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../constants";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation, BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db/api";
import {assert} from "@chainsafe/lodestar-utils";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";

/**
 * is ready to be included in block
 */
export function hasValidAttestationSlot(config: IBeaconConfig, genesisTime: number, attestation: Attestation): boolean {
  const currentSlot = getCurrentSlot(config, genesisTime);
  return attestation.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= currentSlot
        && currentSlot >= attestation.data.slot;
}

export function isUnaggregatedAttestation(
  config: IBeaconConfig, state: BeaconState, epochCtx: EpochContext, attestation: Attestation
): boolean {
  if (state.slot < attestation.data.slot) {
    processSlots(epochCtx, state, attestation.data.slot);
  }
  // Make sure this is unaggregated attestation
  return getAttestingIndicesFromCommittee(
    epochCtx.getBeaconCommittee(attestation.data.slot, attestation.data.index),
    attestation.aggregationBits
  ).length === 1;
}

export async function isAttestingToValidBlock(db: IBeaconDb, attestation: Attestation): Promise<boolean> {
  const blockRoot = attestation.data.beaconBlockRoot.valueOf() as Uint8Array;
  return (await db.block.has(blockRoot)) && (!await db.badBlock.has(blockRoot));
}

export async function hasValidatorAttestedForThatTargetEpoch(
  config: IBeaconConfig, db: IBeaconDb, state: BeaconState, epochCtx: EpochContext, attestation: Attestation
): Promise<boolean> {
  if (state.slot < attestation.data.slot) {
    processSlots(epochCtx, state, attestation.data.slot);
  }
  const existingAttestations = await db.attestation.geAttestationsByTargetEpoch(
    attestation.data.target.epoch
  );
    // each attestation has only 1 validator index
  const existingValidatorIndexes = existingAttestations.map(
    item => getAttestingIndicesFromCommittee(
      epochCtx.getBeaconCommittee(
        item.data.slot,
        item.data.index
      ),
      item.aggregationBits
    )[0]);
    // attestation is unaggregated attestation as validated above
  const committee = epochCtx.getBeaconCommittee(
    attestation.data.slot,
    attestation.data.index
  );
  const validatorIndex = getAttestingIndicesFromCommittee(committee, attestation.aggregationBits)[0];
  return existingValidatorIndexes.includes(validatorIndex);
}

export async function validateAttestation(
  config: IBeaconConfig, db: IBeaconDb, epochCtx: EpochContext, state: BeaconState, attestation: Attestation
): Promise<void> {
  if (state.slot < attestation.data.slot) {
    processSlots(epochCtx, state, attestation.data.slot);
  }
  // Make sure this is unaggregated attestation
  assert.true(
    isUnaggregatedAttestation(config, state, epochCtx, attestation),
    "Attestation is aggregated or doesn't have aggregation bits"
  );
  assert.true(
    !await hasValidatorAttestedForThatTargetEpoch(config, db, state, epochCtx, attestation),
    "Validator already attested for that target epoch"
  );
  assert.true(await isAttestingToValidBlock(db, attestation), "Attestation block missing or invalid");
  assert.true(
    isValidIndexedAttestation(config, state, getIndexedAttestation(config, state, attestation)),
    "Invalid indexed attestation (signature/)"
  );
}

import {
  EpochContext,
  getCurrentSlot,
  isValidIndexedAttestation
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation, BeaconState} from "@chainsafe/lodestar-types";
import {assert, ILogger} from "@chainsafe/lodestar-utils";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../../constants";
import {IBeaconDb} from "../../../db/api";
import {ExtendedValidatorResult} from "../constants";
import {toHexString} from "@chainsafe/ssz";
import {computeSubnetForAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {IBeaconChain} from "../../../chain";

export async function validateGossipCommitteeAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  logger: ILogger,
  attestation: Attestation,
  subnet: number
): Promise<ExtendedValidatorResult> {
  const {state, epochCtx} = await chain.getHeadStateContext();
  const root = config.types.Attestation.hashTreeRoot(attestation);
  if(!hasValidAttestationSlot(config, state.genesisTime, attestation)) {
    logger.warn(
      "Ignoring received gossip committee attestation",
      {
        reason: "invalid attestation slot",
        root: toHexString(root),
        currentSlot: getCurrentSlot(config, state.genesisTime),
        attestationSlot: attestation.data.slot
      }
    );
    return ExtendedValidatorResult.ignore;
  }
  if (state.slot < attestation.data.slot) {
    processSlots(epochCtx, state, attestation.data.slot);
  }
  if (subnet !== computeSubnetForAttestation(config, epochCtx, attestation)) {
    logger.warn(
      "Rejecting received gossip committee attestation",
      {
        reason: "invalid subnet",
        root: toHexString(root),
        subnet,
        expectedSubnet: computeSubnetForAttestation(config, epochCtx, attestation)
      }
    );
    return ExtendedValidatorResult.reject;
  }
  // Make sure this is unaggregated attestation
  if (!isUnaggregatedAttestation(config, state, epochCtx, attestation)) {
    logger.warn(
      "Rejecting received gossip committee attestation",
      {
        reason: "not unaggregated attestation",
        root: toHexString(root),
      }
    );
    return ExtendedValidatorResult.reject;
  }
  if (await hasValidatorAttestedForThatTargetEpoch(config, db, state, epochCtx, attestation)) {
    logger.warn(
      "Ignoring received gossip committee attestation",
      {
        reason: "validator attested to that epoch",
        root: toHexString(root),
      }
    );
    return ExtendedValidatorResult.ignore;
  }
  if (!await isAttestingToValidBlock(db, attestation)) {
    logger.warn(
      "Rejecting received gossip committee attestation",
      {
        reason: "attesting to invalid block",
        root: toHexString(root),
        blockRoot: toHexString(attestation.data.beaconBlockRoot)
      }
    );
    return ExtendedValidatorResult.reject;
  }
  if (!isValidIndexedAttestation(config, state, epochCtx.getIndexedAttestation(attestation))) {
    logger.warn(
      "Rejecting received gossip committee attestation",
      {
        reason: "invalid indexed attestation",
        root: toHexString(root),
      }
    );
    return ExtendedValidatorResult.reject;
  }
  logger.debug("Received gossip committee attestation passed validation", {root: toHexString(root)});
  return ExtendedValidatorResult.accept;
}

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
  return epochCtx.getAttestingIndices(
    attestation.data,
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
    item => epochCtx.getAttestingIndices(
      item.data,
      item.aggregationBits
    )[0]);
    // attestation is unaggregated attestation as validated above
  const validatorIndex = epochCtx.getAttestingIndices(attestation.data, attestation.aggregationBits)[0];
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
    isValidIndexedAttestation(config, state, epochCtx.getIndexedAttestation(attestation)),
    "Invalid indexed attestation (signature/)"
  );
}

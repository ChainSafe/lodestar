import {routes} from "@lodestar/api";
import {ATTESTATION_SUBNET_COUNT} from "@lodestar/params";
import {BeaconStateAllForks, computeSlotsSinceEpochStart} from "@lodestar/state-transition";
import {BLSPubkey, CommitteeIndex, ProducedBlockSource, Slot, SubnetID, ValidatorIndex} from "@lodestar/types";
import {MAX_BUILDER_BOOST_FACTOR} from "@lodestar/validator";
import {BlockSelectionResult, BuilderBlockSelectionReason, EngineBlockSelectionReason} from "./index.js";

export function computeSubnetForCommitteesAtSlot(
  slot: Slot,
  committeesAtSlot: number,
  committeeIndex: CommitteeIndex
): SubnetID {
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
 *       See benchmark -> packages/beacon-node/test/perf/api/impl/validator/attester.test.ts
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

export function selectBlockProductionSource({
  builderSelection,
  engineBlockValue,
  builderBlockValue,
  builderBoostFactor,
}: {
  builderSelection: routes.validator.BuilderSelection;
  engineBlockValue: bigint;
  builderBlockValue: bigint;
  builderBoostFactor: bigint;
}): BlockSelectionResult {
  switch (builderSelection) {
    case routes.validator.BuilderSelection.ExecutionAlways:
    case routes.validator.BuilderSelection.ExecutionOnly:
      return {source: ProducedBlockSource.engine, reason: EngineBlockSelectionReason.EnginePreferred};

    case routes.validator.BuilderSelection.Default:
    case routes.validator.BuilderSelection.MaxProfit: {
      if (builderBoostFactor === BigInt(0)) {
        return {source: ProducedBlockSource.engine, reason: EngineBlockSelectionReason.EnginePreferred};
      }

      if (builderBoostFactor === MAX_BUILDER_BOOST_FACTOR) {
        return {source: ProducedBlockSource.builder, reason: BuilderBlockSelectionReason.BuilderPreferred};
      }

      if (engineBlockValue >= (builderBlockValue * builderBoostFactor) / BigInt(100)) {
        return {source: ProducedBlockSource.engine, reason: EngineBlockSelectionReason.BlockValue};
      }

      return {source: ProducedBlockSource.builder, reason: BuilderBlockSelectionReason.BlockValue};
    }

    case routes.validator.BuilderSelection.BuilderAlways:
    case routes.validator.BuilderSelection.BuilderOnly:
      return {source: ProducedBlockSource.builder, reason: BuilderBlockSelectionReason.BuilderPreferred};
  }
}

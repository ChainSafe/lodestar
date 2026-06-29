import {routes} from "@lodestar/api";
import {ATTESTATION_SUBNET_COUNT} from "@lodestar/params";
import {computeSlotsSinceEpochStart} from "@lodestar/state-transition";
import {CommitteeIndex, ProducedBlockSource, Slot, SubnetID} from "@lodestar/types";
import {MAX_BUILDER_BOOST_FACTOR} from "@lodestar/validator";
import {BlockSelectionResult, BuilderBlockSelectionReason, EngineBlockSelectionReason} from "./index.js";

// Pubkey precompute lives with the duty flows in the engine now; re-exported here for existing callers/tests.
export {getPubkeysForIndices} from "../../../chain/beaconEngine/duties.js";

export function computeSubnetForCommitteesAtSlot(
  slot: Slot,
  committeesAtSlot: number,
  committeeIndex: CommitteeIndex
): SubnetID {
  const slotsSinceEpochStart = computeSlotsSinceEpochStart(slot);
  const committeesSinceEpochStart = committeesAtSlot * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}

export function selectBlockProductionSource({
  builderSelection,
  engineExecutionPayloadValue,
  builderExecutionPayloadValue,
  builderBoostFactor,
}: {
  builderSelection: routes.validator.BuilderSelection;
  engineExecutionPayloadValue: bigint;
  builderExecutionPayloadValue: bigint;
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

      if (engineExecutionPayloadValue >= (builderExecutionPayloadValue * builderBoostFactor) / BigInt(100)) {
        return {source: ProducedBlockSource.engine, reason: EngineBlockSelectionReason.BlockValue};
      }

      return {source: ProducedBlockSource.builder, reason: BuilderBlockSelectionReason.BlockValue};
    }

    case routes.validator.BuilderSelection.BuilderAlways:
    case routes.validator.BuilderSelection.BuilderOnly:
      return {source: ProducedBlockSource.builder, reason: BuilderBlockSelectionReason.BuilderPreferred};
  }
}

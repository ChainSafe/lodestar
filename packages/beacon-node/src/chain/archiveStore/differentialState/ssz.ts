import {ByteListType, ContainerType, ValueOf} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";

const STORAGE_LIMITS = {
  STATE_DIFF_MAX_BYTES: 2 * 1024 * 1024 * 1024, // 2 GiB
  BALANCES_DIFF_MAX_BYTES: 200 * 1024 * 1024, // 200 MiB
} as const;

export const BeaconStateDifferentialType = new ContainerType(
  {
    slot: ssz.Slot,
    baseSlot: ssz.Slot,
    stateDiffBytes: new ByteListType(STORAGE_LIMITS.STATE_DIFF_MAX_BYTES, {typeName: "StateDiff"}),
    balancesDiffBytes: new ByteListType(STORAGE_LIMITS.BALANCES_DIFF_MAX_BYTES, {typeName: "BalancesDiff"}),
  },
  {typeName: "BeaconStateDiff", jsonCase: "eth2"}
);

export type BeaconStateDifferential = ValueOf<typeof BeaconStateDifferentialType>;

/**
 * This type is used to represent the state and balances in a format suitable for differential state computation
 * It will speed up the process of computing the differential state by avoiding the need to serialize and deserialize
 * the entire BeaconState during multiple hierarchical layer operations.
 */
export const BeaconStateSnapshotType = new ContainerType(
  {
    slot: ssz.Slot,
    stateBytes: new ByteListType(STORAGE_LIMITS.STATE_DIFF_MAX_BYTES, {typeName: "StateSnapshot"}),
    balancesBytes: new ByteListType(STORAGE_LIMITS.BALANCES_DIFF_MAX_BYTES, {typeName: "BalancesSnapshot"}),
  },
  {typeName: "BeaconStateSnapshot", jsonCase: "eth2"}
);

export type BeaconStateSnapshot = ValueOf<typeof BeaconStateSnapshotType>;

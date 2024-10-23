import {ByteListType, ContainerType, ListUintNum64Type, BooleanType, ValueOf, UintNumberType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {VALIDATOR_REGISTRY_LIMIT} from "@lodestar/params";
import {BeaconState, Slot} from "@lodestar/types";
import {IStateDiffCodec} from "../types.js";
import {getStateSlotFromBytes} from "../../../util/multifork.js";
import {IBeaconDb} from "../../../db/interface.js";

export const BalancesSSZType = new ListUintNum64Type(VALIDATOR_REGISTRY_LIMIT);

export type Balances = ValueOf<typeof BalancesSSZType>;

export const StateArchiveSSZType = new ContainerType({
  snapshot: new BooleanType(),
  slot: new UintNumberType(8),
  partialState: new ByteListType(99_999_9000),
  balances: new ByteListType(99_999_9000),
});

export type StateArchive = ValueOf<typeof StateArchiveSSZType>;

export function stateToStateArchive(state: BeaconState, forkConfig: ChainForkConfig): StateArchive {
  const partialState = forkConfig.getForkTypes(state.slot).BeaconState.clone(state);

  const balances = BalancesSSZType.clone(partialState.balances);
  partialState.balances = [];

  return {
    snapshot: true,
    slot: state.slot,
    partialState: forkConfig.getForkTypes(state.slot).BeaconState.serialize(partialState),
    balances: BalancesSSZType.serialize(balances),
  };
}

export function stateBytesToStateArchive(stateBytes: Uint8Array, forkConfig: ChainForkConfig): StateArchive {
  const slot = getStateSlotFromBytes(stateBytes);
  return stateToStateArchive(forkConfig.getForkTypes(slot).BeaconState.deserialize(stateBytes), forkConfig);
}

export function stateArchiveToState(stateArchive: StateArchive, forkConfig: ChainForkConfig): BeaconState {
  if (!stateArchive.snapshot) throw new Error("Can not convert a diff state archive to full state");

  const partialState = forkConfig.getForkTypes(stateArchive.slot).BeaconState.deserialize(stateArchive.partialState);
  const balances = BalancesSSZType.deserialize(stateArchive.balances);
  partialState.balances = [...balances];

  return partialState;
}

export function stateArchiveToStateBytes(stateArchive: StateArchive, forkConfig: ChainForkConfig): Uint8Array {
  const state = stateArchiveToState(stateArchive, forkConfig);
  return forkConfig.getForkTypes(state.slot).BeaconState.serialize(state);
}

export function computeDiffArchive(base: StateArchive, updated: StateArchive, codec: IStateDiffCodec): StateArchive {
  if (!base.snapshot) {
    throw new Error("A snapshot state is required to compute binary diff");
  }

  const stateDiff = codec.compute(base.partialState, updated.partialState);
  const balancesDiff = codec.compute(base.balances, updated.balances);

  return {
    snapshot: false,
    slot: updated.slot,
    partialState: stateDiff,
    balances: balancesDiff,
  };
}

export function applyDiffArchive(base: StateArchive, updated: StateArchive, codec: IStateDiffCodec): StateArchive {
  if (!base.snapshot) {
    throw new Error("A snapshot state is required to compute binary diff");
  }

  if (updated.snapshot) {
    throw new Error("A diff state is required to apply binary difference");
  }

  const partialState = codec.apply(base.partialState, updated.partialState);
  const balances = codec.compute(base.balances, updated.balances);

  return {
    snapshot: true,
    slot: updated.slot,
    partialState,
    balances,
  };
}

const DEFAULT_MAX_SEARCH_FALLBACK = 10;

export async function getLastStoredStateArchive({
  db,
  maxFallback,
  snapshot,
}: {db: IBeaconDb; maxFallback?: number; snapshot: boolean}): Promise<StateArchive | null> {
  const lastStoredSlot = await db.stateArchive.lastKey();
  const maxFallbackCount = maxFallback ?? DEFAULT_MAX_SEARCH_FALLBACK;
  let tries = 0;

  if (!lastStoredSlot) return null;

  for await (const archiveBytes of db.stateArchive.valuesStream({lte: lastStoredSlot})) {
    const stateArchive = StateArchiveSSZType.deserialize(archiveBytes);
    if (stateArchive.snapshot === snapshot) return stateArchive;

    if (tries === maxFallbackCount) return null;
    tries += 1;
  }

  return null;
}

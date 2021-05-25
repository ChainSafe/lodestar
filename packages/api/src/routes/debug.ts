import {ForkName, IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, Slot, Root} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {ContainerType} from "@chainsafe/ssz";
import {StateId} from "./beacon/state";
import {
  ArrayOf,
  ContainerData,
  ReturnTypes,
  RouteReqTypeGenerator,
  RoutesData,
  Schema,
  WithVersion,
  TypeJson,
  reqEmpty,
} from "../utils";

/* eslint-disable @typescript-eslint/naming-convention */

type SlotRoot = {slot: Slot; root: Root};

export type Api = {
  /**
   * Get fork choice leaves
   * Retrieves all possible chain heads (leaves of fork choice tree).
   */
  getHeads(): Promise<{data: SlotRoot[]}>;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getState(stateId: StateId): Promise<{data: allForks.BeaconState}>;

  /**
   * Get full BeaconState object
   * Returns full BeaconState object for given stateId.
   * Depending on `Accept` header it can be returned either as json or as bytes serialized by SSZ
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateV2(stateId: StateId): Promise<{data: allForks.BeaconState; version: ForkName}>;
};

export const routesData: RoutesData<Api> = {
  getHeads: {url: "/eth/v1/debug/beacon/heads", method: "GET"},
  getState: {url: "/eth/v1/debug/beacon/states/:stateId", method: "GET"},
  getStateV2: {url: "/eth/v2/debug/beacon/states/:stateId", method: "GET"},
};

export type ReqTypes = {
  [K in keyof ReturnType<typeof getReqSerializers>]: ReturnType<ReturnType<typeof getReqSerializers>[K]["writeReq"]>;
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getReqSerializers() {
  const t = mapValues(routesData, () => (arg: unknown) => arg) as RouteReqTypeGenerator<Api>;

  const getState = t.getState<{params: {stateId: string}}>({
    writeReq: (stateId) => ({params: {stateId}}),
    parseReq: ({params}) => [params.stateId],
    schema: {params: {stateId: Schema.StringRequired}},
  });

  return {
    getHeads: reqEmpty,
    getState: getState,
    getStateV2: getState,
  };
}

export function getReturnTypes(config: IBeaconConfig): ReturnTypes<Api> {
  const SlotRoot = new ContainerType<SlotRoot>({
    fields: {
      slot: config.types.Slot,
      root: config.types.Root,
    },
  });

  return {
    getHeads: ContainerData(ArrayOf(SlotRoot)),
    getState: ContainerData(config.types.phase0.BeaconState),
    getStateV2: WithVersion((fork) => config.types[fork].BeaconState as TypeJson<allForks.BeaconState>),
  };
}

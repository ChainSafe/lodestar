import {IBeaconPreset, BeaconPreset} from "@chainsafe/lodestar-params";
import {IChainConfig, ChainConfig} from "@chainsafe/lodestar-config";
import {Bytes32, Number64, phase0, ssz} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {ByteVectorType, ContainerType, Json, Type} from "@chainsafe/ssz";
import {ArrayOf, ContainerData, ReqEmpty, reqEmpty, ReturnTypes, ReqSerializers, RoutesData, TypeJson} from "../utils";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type DepositContract = {
  chainId: Number64;
  address: Bytes32;
};

export type ISpec = IBeaconPreset & IChainConfig;

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Spec = new ContainerType<ISpec>({
  fields: {
    ...BeaconPreset.fields,
    ...ChainConfig.fields,
  },
  expectedCase: "notransform",
});

export type Api = {
  /**
   * Get deposit contract address.
   * Retrieve Eth1 deposit contract address and chain ID.
   */
  getDepositContract(): Promise<{data: DepositContract}>;

  /**
   * Get scheduled upcoming forks.
   * Retrieve all scheduled upcoming forks this node is aware of.
   */
  getForkSchedule(): Promise<{data: phase0.Fork[]}>;

  /**
   * Get spec params.
   * Retrieve specification configuration used on this node.
   * [Specification params list](https://github.com/ethereum/eth2.0-specs/blob/v1.0.0-rc.0/configs/mainnet/phase0.yaml)
   *
   * Values are returned with following format:
   * - any value starting with 0x in the spec is returned as a hex string
   * - numeric values are returned as a quoted integer
   */
  getSpec(): Promise<{data: ISpec}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getDepositContract: {url: "/eth/v1/config/deposit_contract", method: "GET"},
  getForkSchedule: {url: "/eth/v1/config/fork_schedule", method: "GET"},
  getSpec: {url: "/eth/v1/config/spec", method: "GET"},
};

export type ReqTypes = {[K in keyof Api]: ReqEmpty};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return mapValues(routesData, () => reqEmpty);
}

function withJsonFilled<T>(dataType: Type<T>, fillWith: Json): TypeJson<{data: T}> {
  return {
    toJson: ({data}, opts) => ({data: dataType.toJson(data, opts)}),
    fromJson: ({data}: {data: Json}, opts) => ({data: dataType.fromJson(Object.assign({}, fillWith, data), opts)}),
  };
}

/* eslint-disable @typescript-eslint/naming-convention */
export function getReturnTypes(config: IChainConfig): ReturnTypes<Api> {
  const DepositContract = new ContainerType<DepositContract>({
    fields: {
      chainId: ssz.Number64,
      address: new ByteVectorType({length: 20}),
    },
    // From beacon apis
    casingMap: {
      chainId: "chain_id",
      address: "address",
    },
  });

  return {
    getDepositContract: ContainerData(DepositContract),
    getForkSchedule: ContainerData(ArrayOf(ssz.phase0.Fork)),
    getSpec: withJsonFilled(Spec, ChainConfig.toJson(config)),
  };
}

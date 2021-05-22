import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconParams, BeaconParams} from "@chainsafe/lodestar-params";
import {Bytes32, Number64, phase0} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {ContainerType} from "@chainsafe/ssz";
import {ArrayOf, ContainerData, reqEmpty, ReturnTypes, RouteReqSerdes, RoutesData} from "../utils";

/* eslint-disable @typescript-eslint/naming-convention */

export interface DepositContract {
  chainId: Number64;
  address: Bytes32;
}

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
  getSpec(): Promise<{data: IBeaconParams}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getDepositContract: {url: "/eth/v1/config/deposit_contract", method: "GET"},
  getForkSchedule: {url: "/eth/v1/config/fork_schedule", method: "GET"},
  getSpec: {url: "/eth/v1/config/spec", method: "GET"},
};

export type ReqTypes = {[K in keyof Api]: Record<string, never>};

export function getReqSerdes(): RouteReqSerdes<Api, ReqTypes> {
  return mapValues(routesData, () => reqEmpty);
}

export function getReturnTypes(config: IBeaconConfig): ReturnTypes<Api> {
  const DepositContract = new ContainerType<DepositContract>({
    fields: {
      chainId: config.types.Number64,
      address: config.types.Bytes32, // The byte count doesn't matter
    },
  });

  return {
    getDepositContract: ContainerData(DepositContract),
    getForkSchedule: ContainerData(ArrayOf(config.types.phase0.Fork)),
    getSpec: ContainerData(BeaconParams),
  };
}

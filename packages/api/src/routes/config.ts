import {BeaconPreset} from "@chainsafe/lodestar-params";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {Bytes32, UintNum64, phase0, ssz} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {ByteVectorType, ContainerType} from "@chainsafe/ssz";
import {
  ArrayOf,
  ContainerData,
  ReqEmpty,
  reqEmpty,
  ReturnTypes,
  ReqSerializers,
  RoutesData,
  sameType,
} from "../utils/index.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type DepositContract = {
  chainId: UintNum64;
  address: Bytes32;
};

export type Spec = BeaconPreset & IChainConfig;

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
   * Retrieve specification configuration used on this node.  The configuration should include:
   *  - Constants for all hard forks known by the beacon node, for example the [phase 0](https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/beacon-chain.md#constants) and [altair](https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/beacon-chain.md#constants) values
   *  - Presets for all hard forks supplied to the beacon node, for example the [phase 0](https://github.com/ethereum/consensus-specs/blob/v1.1.10/presets/mainnet/phase0.yaml) and [altair](https://github.com/ethereum/consensus-specs/blob/v1.1.10/presets/mainnet/altair.yaml) values
   *  - Configuration for the beacon node, for example the [mainnet](https://github.com/ethereum/consensus-specs/blob/v1.1.10/configs/mainnet.yaml) values
   *
   * Values are returned with following format:
   * - any value starting with 0x in the spec is returned as a hex string
   * - numeric values are returned as a quoted integer
   */
  getSpec(): Promise<{data: Record<string, string>}>;
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

/* eslint-disable @typescript-eslint/naming-convention */
export function getReturnTypes(): ReturnTypes<Api> {
  const DepositContract = new ContainerType(
    {
      chainId: ssz.UintNum64,
      address: new ByteVectorType(20),
    },
    {jsonCase: "eth2"}
  );

  return {
    getDepositContract: ContainerData(DepositContract),
    getForkSchedule: ContainerData(ArrayOf(ssz.phase0.Fork)),
    getSpec: ContainerData(sameType()),
  };
}

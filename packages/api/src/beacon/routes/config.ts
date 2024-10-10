import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {
  ArrayOf,
  EmptyArgs,
  EmptyRequestCodec,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  JsonOnlyResp,
} from "../../utils/codecs.js";
import {Endpoint, RouteDefinitions} from "../../utils/index.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export const DepositContractType = new ContainerType(
  {
    chainId: ssz.UintNum64,
    address: ssz.ExecutionAddress,
  },
  {jsonCase: "eth2"}
);

export const ForkListType = ArrayOf(ssz.phase0.Fork);

export type DepositContract = ValueOf<typeof DepositContractType>;
export type ForkList = ValueOf<typeof ForkListType>;
export type Spec = Record<string, string>;

export type Endpoints = {
  /**
   * Get deposit contract address.
   * Retrieve Eth1 deposit contract address and chain ID.
   */
  getDepositContract: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    DepositContract,
    EmptyMeta
  >;

  /**
   * Get scheduled upcoming forks.
   * Retrieve all scheduled upcoming forks this node is aware of.
   */
  getForkSchedule: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    ForkList,
    EmptyMeta
  >;

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
  getSpec: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    Spec,
    EmptyMeta
  >;
};

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getDepositContract: {
      url: "/eth/v1/config/deposit_contract",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: DepositContractType,
        meta: EmptyMetaCodec,
      },
    },
    getForkSchedule: {
      url: "/eth/v1/config/fork_schedule",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: ForkListType,
        meta: EmptyMetaCodec,
      },
    },
    getSpec: {
      url: "/eth/v1/config/spec",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResp({
        data: {
          toJson: (data) => data,
          fromJson: (data) => {
            if (typeof data !== "object" || data === null) {
              throw Error("JSON must be of type object");
            }
            return data as Spec;
          },
        },
        meta: EmptyMetaCodec,
      }),
    },
  };
}

/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {StringType, ssz} from "@lodestar/types";
import {ArrayOf, EmptyArgs, EmptyGetRequestCodec, EmptyMeta, EmptyMetaCodec, EmptyRequest} from "../../utils/codecs.js";
import {Endpoint, RouteDefinitions} from "../../utils/index.js";
import {WireFormat} from "../../utils/headers.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export const DepositContractType = new ContainerType({
  chainId: ssz.UintNum64,
  address: ssz.ExecutionAddress,
});

// TODO: consider dropping this type if we cant support ssz anyways
export const StringRecordType = ArrayOf(
  new ContainerType({
    key: new StringType(),
    value: new StringType(),
  })
);
export const ForkListType = ArrayOf(ssz.phase0.Fork);

export type DepositContract = ValueOf<typeof DepositContractType>;
export type StringRecord = ValueOf<typeof StringRecordType>;
export type ForkList = ValueOf<typeof ForkListType>;

export type Endpoints = {
  /**
   * Get deposit contract address.
   * Retrieve Eth1 deposit contract address and chain ID.
   */
  getDepositContract: Endpoint<
    //
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
    //
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
    //
    "GET",
    EmptyArgs,
    EmptyRequest,
    StringRecord,
    EmptyMeta
  >;
};

export const definitions: RouteDefinitions<Endpoints> = {
  getDepositContract: {
    url: "/eth/v1/config/deposit_contract",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: DepositContractType,
      meta: EmptyMetaCodec,
    },
  },
  getForkSchedule: {
    url: "/eth/v1/config/fork_schedule",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: ForkListType,
      meta: EmptyMetaCodec,
    },
  },
  getSpec: {
    url: "/eth/v1/config/spec",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: StringRecordType,
      meta: EmptyMetaCodec,
      transform: {
        toResponse: (data) => {
          // TODO: shouldn't this be wrapped inside `{data: ...}`?
          return data.reduce((json, {key, value}) => ((json[key] = value), json), {} as Record<string, string>);
        },
        fromResponse: (resp) => {
          return {data: Object.entries(resp as Record<string, string>).map(([key, value]) => ({key, value}))};
        },
      },
      onlySupport: WireFormat.json,
    },
  },
};

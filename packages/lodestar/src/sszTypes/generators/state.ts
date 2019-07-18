/**
 * @module sszTypes/generators
 */

import {SimpleContainerType} from "@chainsafe/ssz";

import {IBeaconParams} from "../../params";
import {IBeaconSSZTypes} from "../interface";

export const BeaconState = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  name: "BeaconState",
  fields: [
    // Misc
    ["slot", ssz.Slot],
    ["genesisTime", ssz.number64],
    ["fork", ssz.Fork],
    // Validator Registry
    ["validatorRegistry", [ssz.Validator]],
    ["balances", [ssz.Gwei]],
    // Randomness and committees
    ["latestRandaoMixes", [ssz.bytes32, params.LATEST_RANDAO_MIXES_LENGTH]],
    ["latestStartShard", ssz.Shard],
    // Finality
    ["previousEpochAttestations", [ssz.PendingAttestation]],
    ["currentEpochAttestations", [ssz.PendingAttestation]],
    ["previousJustifiedEpoch", ssz.Epoch],
    ["currentJustifiedEpoch", ssz.Epoch],
    ["previousJustifiedRoot", ssz.bytes32],
    ["currentJustifiedRoot", ssz.bytes32],
    ["justificationBitfield", ssz.uint64],
    ["finalizedEpoch", ssz.Epoch],
    ["finalizedRoot", ssz.bytes32],
    // Recent State
    ["currentCrosslinks", [ssz.Crosslink, params.SHARD_COUNT]],
    ["previousCrosslinks", [ssz.Crosslink, params.SHARD_COUNT]],
    ["latestBlockRoots", [ssz.bytes32, params.SLOTS_PER_HISTORICAL_ROOT]],
    ["latestStateRoots", [ssz.bytes32, params.SLOTS_PER_HISTORICAL_ROOT]],
    ["latestActiveIndexRoots", [ssz.bytes32, params.LATEST_ACTIVE_INDEX_ROOTS_LENGTH]],
    ["latestSlashedBalances", [ssz.Gwei, params.LATEST_SLASHED_EXIT_LENGTH]],
    ["latestBlockHeader", ssz.BeaconBlockHeader],
    ["historicalRoots", [ssz.bytes32]],
    // Eth1
    ["latestEth1Data", ssz.Eth1Data],
    ["eth1DataVotes", [ssz.Eth1Data]],
    ["depositIndex", ssz.number64],
  ],
});

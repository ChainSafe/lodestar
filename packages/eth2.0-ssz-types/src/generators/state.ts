/**
 * @module sszTypes/generators
 */

import {IBeaconParams} from "@chainsafe/eth2.0-params";
import {SimpleContainerType} from "@chainsafe/ssz";

import {JUSTIFICATION_BITS_LENGTH} from "../constants";
import {IBeaconSSZTypes} from "../interface";

export const BeaconState = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    // Misc
    ["genesisTime", ssz.number64],
    ["slot", ssz.Slot],
    ["fork", ssz.Fork],
    // History
    ["latestBlockHeader", ssz.BeaconBlockHeader],
    ["blockRoots", {
      elementType: ssz.Hash,
      length: params.SLOTS_PER_HISTORICAL_ROOT,
    }],
    ["stateRoots", {
      elementType: ssz.Hash,
      length: params.SLOTS_PER_HISTORICAL_ROOT,
    }],
    ["historicalRoots", {
      elementType: ssz.Hash,
      maxLength: params.HISTORICAL_ROOTS_LIMIT,
    }],
    // Eth1
    ["eth1Data", ssz.Eth1Data],
    ["eth1DataVotes", {
      elementType: ssz.Eth1Data,
      maxLength: params.SLOTS_PER_ETH1_VOTING_PERIOD,
    }],
    ["eth1DepositIndex", ssz.number64],
    // Registry
    ["validators", {
      elementType: ssz.Validator,
      maxLength: params.VALIDATOR_REGISTRY_LIMIT,
    }],
    ["balances", {
      elementType: ssz.Gwei,
      maxLength: params.VALIDATOR_REGISTRY_LIMIT,
    }],
    // Shuffling
    ["startShard", ssz.Shard],
    ["randaoMixes", {
      elementType: ssz.Hash,
      length: params.EPOCHS_PER_HISTORICAL_VECTOR,
    }],
    ["activeIndexRoots", {
      elementType: ssz.Hash,
      length: params.EPOCHS_PER_HISTORICAL_VECTOR,
    }],
    ["compactCommitteesRoots", {
      elementType: ssz.Hash,
      length: params.EPOCHS_PER_HISTORICAL_VECTOR,
    }],
    // Slashings
    ["slashings", {
      elementType: ssz.Gwei,
      length: params.EPOCHS_PER_SLASHINGS_VECTOR,
    }],
    // Attestations
    ["previousEpochAttestations", {
      elementType: ssz.PendingAttestation,
      maxLength: params.MAX_ATTESTATIONS * params.SLOTS_PER_EPOCH,
    }],
    ["currentEpochAttestations", {
      elementType: ssz.PendingAttestation,
      maxLength: params.MAX_ATTESTATIONS * params.SLOTS_PER_EPOCH,
    }],
    // Crosslinks
    ["previousCrosslinks", {
      elementType: ssz.Crosslink,
      length: params.SHARD_COUNT,
    }],
    ["currentCrosslinks", {
      elementType: ssz.Crosslink,
      length: params.SHARD_COUNT,
    }],
    // Finality
    ["justificationBits", {
      elementType: ssz.bool,
      length: JUSTIFICATION_BITS_LENGTH,
    }],
    ["previousJustifiedCheckpoint", ssz.Checkpoint],
    ["currentJustifiedCheckpoint", ssz.Checkpoint],
    ["finalizedCheckpoint", ssz.Checkpoint],
  ],
});

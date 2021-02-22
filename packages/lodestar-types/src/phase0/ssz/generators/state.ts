/**
 * @module sszTypes/generators
 */

import {IPhase0Params} from "@chainsafe/lodestar-params";
import {BitVectorType, ContainerType, ListType, RootType, VectorType} from "@chainsafe/ssz";

import {JUSTIFICATION_BITS_LENGTH} from "../constants";
import {IPhase0SSZTypes} from "../interface";

export const EpochAttestations = (ssz: IPhase0SSZTypes, params: IPhase0Params): ListType =>
  new ListType({
    elementType: ssz.PendingAttestation,
    limit: params.MAX_ATTESTATIONS * params.SLOTS_PER_EPOCH,
  });

export const BeaconState = (ssz: IPhase0SSZTypes, params: IPhase0Params): ContainerType =>
  new ContainerType({
    fields: {
      // Misc
      genesisTime: ssz.Number64,
      genesisValidatorsRoot: ssz.Root,
      slot: ssz.Slot,
      fork: ssz.Fork,
      // History
      latestBlockHeader: ssz.BeaconBlockHeader,
      blockRoots: ssz.HistoricalBlockRoots,
      stateRoots: ssz.HistoricalStateRoots,
      historicalRoots: new ListType({
        elementType: new RootType({
          expandedType: ssz.HistoricalBatch,
        }),
        limit: params.HISTORICAL_ROOTS_LIMIT,
      }),
      // Eth1
      eth1Data: ssz.Eth1Data,
      eth1DataVotes: new ListType({
        elementType: ssz.Eth1Data,
        limit: params.EPOCHS_PER_ETH1_VOTING_PERIOD * params.SLOTS_PER_EPOCH,
      }),
      eth1DepositIndex: ssz.Number64,
      // Registry
      validators: new ListType({
        elementType: ssz.Validator,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      balances: new ListType({
        elementType: ssz.Gwei,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      randaoMixes: new VectorType({
        elementType: ssz.Bytes32,
        length: params.EPOCHS_PER_HISTORICAL_VECTOR,
      }),
      // Slashings
      slashings: new VectorType({
        elementType: ssz.Gwei,
        length: params.EPOCHS_PER_SLASHINGS_VECTOR,
      }),
      // Attestations
      previousEpochAttestations: ssz.EpochAttestations,
      currentEpochAttestations: ssz.EpochAttestations,
      // Finality
      justificationBits: new BitVectorType({
        length: JUSTIFICATION_BITS_LENGTH,
      }),
      previousJustifiedCheckpoint: ssz.Checkpoint,
      currentJustifiedCheckpoint: ssz.Checkpoint,
      finalizedCheckpoint: ssz.Checkpoint,
    },
  });

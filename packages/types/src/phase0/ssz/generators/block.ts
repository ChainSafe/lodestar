/**
 * @module sszTypes/generators
 */

import {IPhase0Params} from "@chainsafe/lodestar-params";
import {ContainerType, ListType, RootType} from "@chainsafe/ssz";

import {IPhase0SSZTypes} from "../interface";

export const BeaconBlockBody = (ssz: IPhase0SSZTypes, params: IPhase0Params): ContainerType =>
  new ContainerType({
    fields: {
      randaoReveal: ssz.BLSSignature,
      eth1Data: ssz.Eth1Data,
      graffiti: ssz.Bytes32,
      proposerSlashings: new ListType({
        elementType: ssz.ProposerSlashing,
        limit: params.MAX_PROPOSER_SLASHINGS,
      }),
      attesterSlashings: new ListType({
        elementType: ssz.AttesterSlashing,
        limit: params.MAX_ATTESTER_SLASHINGS,
      }),
      attestations: new ListType({
        elementType: ssz.Attestation,
        limit: params.MAX_ATTESTATIONS,
      }),
      deposits: new ListType({
        elementType: ssz.Deposit,
        limit: params.MAX_DEPOSITS,
      }),
      voluntaryExits: new ListType({
        elementType: ssz.SignedVoluntaryExit,
        limit: params.MAX_VOLUNTARY_EXITS,
      }),
    },
  });

export const BeaconBlock = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      proposerIndex: ssz.ValidatorIndex,
      parentRoot: new RootType({
        expandedType: () => ssz.BeaconBlock,
      }),
      stateRoot: new RootType({
        expandedType: () => ssz.BeaconState,
      }),
      body: ssz.BeaconBlockBody,
    },
  });

export const SignedBeaconBlock = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      message: ssz.BeaconBlock,
      signature: ssz.BLSSignature,
    },
  });

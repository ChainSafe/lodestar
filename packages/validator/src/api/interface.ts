import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {
  Epoch,
  Slot,
  Root,
  phase0,
  ValidatorIndex,
  BLSSignature,
  CommitteeIndex,
  altair,
} from "@chainsafe/lodestar-types";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";
import {IValidatorFilters} from "../util";

export type StateId = "head";
export type BlockId = "head" | Slot;

export enum BeaconEventType {
  BLOCK = "block",
  CHAIN_REORG = "chain_reorg",
  HEAD = "head",
}

export type BeaconBlockEvent = {type: typeof BeaconEventType.BLOCK; message: phase0.BlockEventPayload};
export type BeaconChainReorgEvent = {type: typeof BeaconEventType.CHAIN_REORG; message: phase0.ChainReorg};
export type HeadEvent = {type: typeof BeaconEventType.HEAD; message: phase0.ChainHead};
export type BeaconEvent = BeaconBlockEvent | BeaconChainReorgEvent | HeadEvent;

export interface IApiClientEvents {
  [BeaconEventType.BLOCK]: (evt: BeaconBlockEvent["message"]) => void;
  [BeaconEventType.CHAIN_REORG]: (evt: BeaconChainReorgEvent["message"]) => void;
  [BeaconEventType.HEAD]: (evt: HeadEvent["message"]) => void;
}

export type ApiClientEventEmitter = StrictEventEmitter<EventEmitter, IApiClientEvents>;

export interface IApiClient {
  beacon: {
    state: {
      getFork(stateId: StateId): Promise<phase0.Fork>;
      getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<phase0.ValidatorResponse[]>;
    };
    blocks: {
      publishBlock(block: phase0.SignedBeaconBlock): Promise<void>;
      getBlockHeader(blockId: BlockId): Promise<phase0.SignedBeaconBlockHeader>;
    };
    pool: {
      submitAttestations(attestation: phase0.Attestation[]): Promise<void>;
      submitVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit): Promise<void>;
      submitSyncCommitteeSignatures(signatures: altair.SyncCommitteeSignature[]): Promise<void>;
    };
    getGenesis(): Promise<phase0.Genesis>;
  };

  config: {
    getForkSchedule(): Promise<phase0.Fork[]>;
  };

  node: {
    getVersion(): Promise<string>;
    getSyncingStatus(): Promise<phase0.SyncingStatus>;
  };

  events: {
    getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent>;
  };

  validator: {
    getProposerDuties(epoch: Epoch): Promise<phase0.ProposerDutiesApi>;
    getAttesterDuties(epoch: Epoch, validatorIndices: ValidatorIndex[]): Promise<phase0.AttesterDutiesApi>;
    getSyncCommitteeDuties(epoch: number, validatorIndices: ValidatorIndex[]): Promise<altair.SyncDutiesApi>;
    produceBlock(slot: Slot, randaoReveal: BLSSignature, graffiti: string): Promise<phase0.BeaconBlock>;
    produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData>;
    produceSyncCommitteeContribution(
      slot: Slot,
      subcommitteeIndex: number,
      beaconBlockRoot: Root
    ): Promise<altair.SyncCommitteeContribution>;
    getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<phase0.Attestation>;
    publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void>;
    publishContributionAndProofs(contributionAndProofs: altair.SignedContributionAndProof[]): Promise<void>;
    prepareBeaconCommitteeSubnet(subscriptions: phase0.BeaconCommitteeSubscription[]): Promise<void>;
    prepareSyncCommitteeSubnets(subscriptions: altair.SyncCommitteeSubscription[]): Promise<void>;
  };
}

export interface IApiClientValidator extends IApiClient {
  url: string;
  registerAbortSignal(signal: AbortSignal): void;
}

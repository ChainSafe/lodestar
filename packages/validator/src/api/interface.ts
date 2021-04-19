import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {Epoch, Slot, Root, phase0, ValidatorIndex, BLSSignature, CommitteeIndex} from "@chainsafe/lodestar-types";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";
import {IValidatorFilters} from "../util";

export type StateId = "head";

export enum BeaconEventType {
  BLOCK = "block",
  CHAIN_REORG = "chain_reorg",
  HEAD = "head",
}

export type BeaconBlockEvent = {type: typeof BeaconEventType.BLOCK; message: phase0.BlockEventPayload};
export type BeaconChainReorgEvent = {type: typeof BeaconEventType.CHAIN_REORG; message: phase0.ChainReorg};
export type HeadEvent = {type: typeof BeaconEventType.HEAD; message: phase0.ChainHead};
export type BeaconEvent = BeaconBlockEvent | BeaconChainReorgEvent | HeadEvent;

export enum ClockEventType {
  CLOCK_SLOT = "clock_slot",
  CLOCK_EPOCH = "clock_epoch",
}

export type ClockSlotEvent = {type: typeof ClockEventType.CLOCK_SLOT; message: {slot: number}};
export type ClockEpochEvent = {type: typeof ClockEventType.CLOCK_EPOCH; message: {epoch: number}};

export interface IApiClientEvents {
  beaconChainStarted: () => void;
  [BeaconEventType.BLOCK]: (evt: BeaconBlockEvent["message"]) => void;
  [BeaconEventType.CHAIN_REORG]: (evt: BeaconChainReorgEvent["message"]) => void;
  [BeaconEventType.HEAD]: (evt: HeadEvent["message"]) => void;
  [ClockEventType.CLOCK_SLOT]: (evt: ClockSlotEvent["message"]) => void;
  [ClockEventType.CLOCK_EPOCH]: (evt: ClockEpochEvent["message"]) => void;
}

export type ApiClientEventEmitter = StrictEventEmitter<EventEmitter, IApiClientEvents>;

export interface IBeaconClock {
  currentSlot: Slot;
  currentEpoch: Epoch;
}

export interface IApiClientProvider extends ApiClientEventEmitter, IApiClient {
  clock: IBeaconClock;
  genesisValidatorsRoot: Root;
  url: string;

  /**
   * Initiates connection to rpc server.
   */
  connect(): Promise<void>;

  /**
   * Destroys connection to rpc server.
   */
  disconnect(): Promise<void>;
}

export interface IApiClient {
  beacon: {
    state: {
      getFork(stateId: StateId): Promise<phase0.Fork>;
      getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<phase0.ValidatorResponse[]>;
    };
    blocks: {
      publishBlock(block: phase0.SignedBeaconBlock): Promise<void>;
    };
    pool: {
      submitAttestations(attestation: phase0.Attestation[]): Promise<void>;
      submitVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit): Promise<void>;
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
    getProposerDuties(epoch: Epoch): Promise<phase0.ProposerDuty[]>;
    getAttesterDuties(epoch: Epoch, validatorIndices: ValidatorIndex[]): Promise<phase0.AttesterDuty[]>;
    produceBlock(slot: Slot, randaoReveal: BLSSignature, graffiti: string): Promise<phase0.BeaconBlock>;
    produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData>;
    getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<phase0.Attestation>;
    publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void>;
    prepareBeaconCommitteeSubnet(subscriptions: phase0.BeaconCommitteeSubscription[]): Promise<void>;
  };
}

export interface IApiClientValidator extends IApiClient {
  registerAbortSignal?(signal: AbortSignal): void;
}

import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {PayloadStatus} from "@lodestar/fork-choice";
import {Epoch, RootHex, Slot, phase0} from "@lodestar/types";
import type {SerializedLightClientData} from "./interface.js";

// TODO - beacon engine: apply pull model, ie core should not emit events with data
export enum BeaconEngineEvent {
  fatalError = "fatalError",
  builderRegistered = "builderRegistered",
  earliestAvailableSlotUpdated = "earliestAvailableSlotUpdated",
  proposerSlashingProduced = "proposerSlashingProduced",
  fastConfirmation = "fastConfirmation",
  lightClientOptimisticUpdate = "lightClientOptimisticUpdate",
  lightClientFinalityUpdate = "lightClientFinalityUpdate",
  checkpoint = "checkpoint",
}

export type HeadUpdate<TRoot = RootHex> = {
  slot: Slot;
  blockRoot: TRoot;
  stateRoot: TRoot;
  payloadStatus: PayloadStatus;
  headRootChanged: boolean;
  epochTransition: boolean;
  previousDutyDependentRoot: TRoot;
  currentDutyDependentRoot: TRoot;
  executionOptimistic: boolean;
};

export type ChainReorg<TRoot = RootHex> = {
  slot: Slot;
  depth: number;
  oldHeadBlock: TRoot;
  newHeadBlock: TRoot;
  oldHeadState: TRoot;
  newHeadState: TRoot;
  epoch: Epoch;
  executionOptimistic: boolean;
};

export type FastConfirmation = {block: RootHex; slot: Slot; currentSlot: Slot};

export type BeaconEngineEventData = {
  [BeaconEngineEvent.earliestAvailableSlotUpdated]: Slot;
  [BeaconEngineEvent.fatalError]: Error;
  [BeaconEngineEvent.builderRegistered]: string;
  [BeaconEngineEvent.proposerSlashingProduced]: phase0.ProposerSlashing;
  [BeaconEngineEvent.fastConfirmation]: FastConfirmation;
  [BeaconEngineEvent.lightClientOptimisticUpdate]: SerializedLightClientData;
  [BeaconEngineEvent.lightClientFinalityUpdate]: SerializedLightClientData;
  [BeaconEngineEvent.checkpoint]: phase0.Checkpoint;
};

export type IBeaconEngineEventBus = StrictEventEmitter<
  EventEmitter,
  {[K in BeaconEngineEvent]: (data: BeaconEngineEventData[K]) => void}
>;
export class BeaconEngineEventBus extends (EventEmitter as {new (): IBeaconEngineEventBus}) {}

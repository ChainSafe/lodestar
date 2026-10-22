import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {PayloadStatus} from "@lodestar/fork-choice";
import {Epoch, RootHex, Slot, phase0} from "@lodestar/types";
import {ChainViewUpdate} from "../chainView/interface.js";
import type {SerializedLightClientData} from "./interface.js";

export enum BeaconEngineEvent {
  fatalError = "fatalError",
  builderRegistered = "builderRegistered",
  // TODO - beacon engine: may remove this
  chainViewUpdated = "chainViewUpdated",
  earliestAvailableSlotUpdated = "earliestAvailableSlotUpdated",
  headUpdated = "headUpdated",
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
  [BeaconEngineEvent.headUpdated]: HeadUpdate;
  [BeaconEngineEvent.earliestAvailableSlotUpdated]: Slot;
  [BeaconEngineEvent.fatalError]: Error;
  [BeaconEngineEvent.builderRegistered]: string;
  [BeaconEngineEvent.chainViewUpdated]: ChainViewUpdate;
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

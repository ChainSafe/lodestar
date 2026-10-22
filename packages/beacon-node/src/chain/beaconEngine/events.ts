import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {PayloadStatus} from "@lodestar/fork-choice";
import {BuilderIndex, Epoch, RootHex, Slot, phase0} from "@lodestar/types";
import {ChainViewUpdate} from "../chainView/interface.js";
import type {SerializedLightClientData} from "./interface.js";

export enum BeaconEngineEvent {
  fatalError = "fatalError",
  builderRegistered = "builderRegistered",
  executionPayloadImported = "executionPayloadImported",
  // TODO - beacon engine: may remove this
  chainViewUpdated = "chainViewUpdated",
  newFinalizedCheckpoint = "newFinalizedCheckpoint",
  earliestAvailableSlotUpdated = "earliestAvailableSlotUpdated",
  headUpdated = "headUpdated",
  chainReorg = "chainReorg",
  proposerSlashingProduced = "proposerSlashingProduced",
  fastConfirmation = "fastConfirmation",
  lightClientOptimisticUpdate = "lightClientOptimisticUpdate",
  lightClientFinalityUpdate = "lightClientFinalityUpdate",
  checkpoint = "checkpoint",
}

export type HeadUpdate = {
  slot: Slot;
  blockRoot: RootHex;
  stateRoot: RootHex;
  payloadStatus: PayloadStatus;
  headRootChanged: boolean;
  epochTransition: boolean;
  previousDutyDependentRoot: RootHex;
  currentDutyDependentRoot: RootHex;
  executionOptimistic: boolean;
};

export type ChainReorg = {
  slot: Slot;
  depth: number;
  oldHeadBlock: RootHex;
  newHeadBlock: RootHex;
  oldHeadState: RootHex;
  newHeadState: RootHex;
  epoch: Epoch;
  executionOptimistic: boolean;
};

export type FastConfirmation = {block: RootHex; slot: Slot; currentSlot: Slot};

export type ExecutionPayloadImported = {
  slot: Slot;
  builderIndex: BuilderIndex;
  blockHash: RootHex;
  blockRoot: RootHex;
  executionOptimistic: boolean;
};

export type BeaconEngineEventData = {
  [BeaconEngineEvent.headUpdated]: HeadUpdate;
  [BeaconEngineEvent.earliestAvailableSlotUpdated]: Slot;
  [BeaconEngineEvent.fatalError]: Error;
  [BeaconEngineEvent.builderRegistered]: string;
  [BeaconEngineEvent.executionPayloadImported]: ExecutionPayloadImported;
  [BeaconEngineEvent.chainViewUpdated]: ChainViewUpdate;
  [BeaconEngineEvent.newFinalizedCheckpoint]: void;
  [BeaconEngineEvent.chainReorg]: ChainReorg;
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

import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {PayloadStatus} from "@lodestar/fork-choice";
import {Epoch, Root, RootHex, Slot, phase0} from "@lodestar/types";
import type {SerializedLightClientData} from "./interface.js";

// TODO - beacon engine: apply pull model, ie core should not emit events with data
export enum BeaconEngineEvent {
  fatalError = "fatalError",
  localProposalSlots = "localProposalSlots",
  executionInvalidated = "executionInvalidated",
  proposerSlashingProduced = "proposerSlashingProduced",
  fastConfirmation = "fastConfirmation",
  lightClientOptimisticUpdate = "lightClientOptimisticUpdate",
  lightClientFinalityUpdate = "lightClientFinalityUpdate",
}

/** Core-internal events, never forwarded to BeaconEngine */
export enum BeaconEngineCoreEvent {
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

export type ExecutionInvalidation = {
  previousHead: {blockRoot: Root; payloadStatus: PayloadStatus};
  reorg: ChainReorg<Root> | null;
  version: number;
};

export type BeaconEngineEventData = {
  [BeaconEngineEvent.localProposalSlots]: Slot[];
  [BeaconEngineEvent.executionInvalidated]: ExecutionInvalidation;
  [BeaconEngineEvent.fatalError]: Error;
  [BeaconEngineEvent.proposerSlashingProduced]: phase0.ProposerSlashing;
  [BeaconEngineEvent.fastConfirmation]: FastConfirmation;
  [BeaconEngineEvent.lightClientOptimisticUpdate]: SerializedLightClientData;
  [BeaconEngineEvent.lightClientFinalityUpdate]: SerializedLightClientData;
};

export type IBeaconEngineEventBus = StrictEventEmitter<
  EventEmitter,
  {[K in BeaconEngineEvent]: (data: BeaconEngineEventData[K]) => void}
>;
export class BeaconEngineEventBus extends (EventEmitter as {new (): IBeaconEngineEventBus}) {}

export type IBeaconEngineCoreEventBus = StrictEventEmitter<
  EventEmitter,
  {[BeaconEngineCoreEvent.checkpoint]: (cp: phase0.Checkpoint) => void}
>;
export class BeaconEngineCoreEventBus extends (EventEmitter as {new (): IBeaconEngineCoreEventBus}) {}

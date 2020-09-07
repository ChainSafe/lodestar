/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module chain/forkChoice
 */
import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {Checkpoint, Gwei, Slot, ValidatorIndex, Epoch} from "@chainsafe/lodestar-types";

export interface IForkChoiceEvents {
  prune: (finalized: BlockSummary, pruned: BlockSummary[]) => void;
}

export type ForkChoiceEventEmitter = StrictEventEmitter<EventEmitter, IForkChoiceEvents>;

export interface ILMDGHOST {
  onTick(): void;
  addBlock(info: BlockSummary): void;
  addAttestation(blockRoot: Uint8Array, attester: ValidatorIndex, weight: Gwei): void;
  head(): BlockSummary | null;
  headBlockSlot(): Slot;
  headBlockRoot(): Uint8Array;
  headStateRoot(): Uint8Array;
  getJustified(): Checkpoint | null;
  getFinalized(): Checkpoint | null;
  getAncestor(root: Uint8Array, slot: Slot): Uint8Array | null;
  getBlockSummariesAtSlot(slot: Slot): BlockSummary[];
  getCanonicalBlockSummaryAtSlot(slot: Slot): BlockSummary | null;
  getBlockSummaryByBlockRoot(blockRoot: Uint8Array): BlockSummary | null;
  getBlockSummaryByParentBlockRoot(blockRoot: Uint8Array): BlockSummary[];
  getBlockSummariesByAncestorBlockRoot(ancestorRoot: Uint8Array, stateRoots: Uint8Array[]): BlockSummary[] | null;
  hasBlock(blockRoot: Uint8Array): boolean;
}

/*
 * Info of Block and Chain for forkchoice
 */
export interface BlockSummary {
  slot: Slot;
  blockRoot: Uint8Array;
  parentRoot: Uint8Array;
  stateRoot: Uint8Array;
  justifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
}

/**
 * Root is a block root as a hex string
 *
 * Used here for light weight and easy comparison
 */
export type RootHex = string;

/**
 * Minimal representation of attsetation for the purposes of fork choice
 */
export interface ForkChoiceAttestation {
  target: RootHex;
  attester: ValidatorIndex;
  weight: Gwei;
}

/**
 * Attestation aggregated across participants
 */
export interface AggregatedAttestation {
  target: RootHex;
  weight: Gwei;
  prevWeight: Gwei;
}

/**
 * Same to Checkpoint but with root as hex string
 * this helps checkpoint's check inside node without a config
 */
export interface HexCheckpoint {
  rootHex: RootHex;
  epoch: Epoch;
}

// non Existent node
export const NO_NODE = -1;

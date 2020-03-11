/* eslint-disable @typescript-eslint/interface-name-prefix */
import {Slot, Epoch, ValidatorIndex, Gwei} from "@chainsafe/lodestar-types";
import {Node} from "./lmdGhost";

/**
 * Interface to initialize a Node.
 */
export interface NodeInfo {
  slot: Slot;
  blockRoot: RootHex;
  parent: Node;
  justifiedCheckpoint: HexCheckpoint;
  finalizedCheckpoint: HexCheckpoint;
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
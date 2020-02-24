import {EventEmitter} from "events";

import {TreeBacked, List} from "@chainsafe/ssz";
import {
  Attestation, BeaconState, Checkpoint, Slot, Uint16, Uint64, Root, SignedBeaconBlock,
} from "@chainsafe/eth2.0-types";

import {ILMDGHOST} from "./forkChoice";
import StrictEventEmitter from "strict-event-emitter-types";
import {IBeaconClock} from "./clock/interface";

export interface IChainEvents {
  unknownBlockRoot: (root: Root) => void;
  processedBlock: (signedBlock: SignedBeaconBlock) => void;
  processedCheckpoint: (checkPoint: Checkpoint) => void;
  processedAttestation: (attestation: Attestation) => void;
  justifiedCheckpoint: (checkpoint: Checkpoint) => void;
  finalizedCheckpoint: (checkpoint: Checkpoint) => void;
}

export type ChainEventEmitter = StrictEventEmitter<EventEmitter, IChainEvents>;

/**
 * The IBeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export interface IBeaconChain extends ChainEventEmitter {
  latestState: BeaconState|null;
  forkChoice: ILMDGHOST;
  clock: IBeaconClock;
  chainId: Uint16;
  networkId: Uint64;
  /**
   * Start beacon chain processing
   */
  start(): Promise<void>;

  /**
   * Stop beacon chain processing
   */
  stop(): Promise<void>;

  /**
   * Add attestation to the fork-choice rule
   */
  receiveAttestation(attestation: Attestation): Promise<void>;

  /**
   * Pre-process and run the per slot state transition function
   */
  receiveBlock(signedBlock: SignedBeaconBlock, trusted?: boolean): Promise<void>;

  /**
   * Update the chain head using LMD GHOST
   */
  applyForkChoiceRule(): Promise<void>;

  /**
   * Ensure that the block is compliant with block processing validity conditions
   */
  isValidBlock(state: BeaconState, signedBlock: SignedBeaconBlock): Promise<boolean>;

  advanceState(slot?: Slot): Promise<void>;

  /**
   * Used for starting beacon chain with fake genesis state (dev, test, interop).
   * Note: Invoke this before {@link start}
   */
  initializeBeaconChain(genesisState: BeaconState, depositDataRootList: TreeBacked<List<Root>>): Promise<void>;

  isInitialized(): boolean;
}

export interface IAttestationProcessor {
  receiveBlock(signedBlock: SignedBeaconBlock, trusted?: boolean): Promise<void>;
  receiveAttestation(attestation: Attestation): Promise<void>;
}

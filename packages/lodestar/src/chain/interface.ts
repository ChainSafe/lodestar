import {
  Attestation,
  BeaconState,
  Checkpoint,
  ENRForkID,
  ForkDigest,
  Number64,
  Root,
  SignedBeaconBlock,
  Slot,
  Uint16,
  Uint64,
} from "@chainsafe/lodestar-types";

import {ILMDGHOST} from "./forkChoice";
import {IBeaconClock} from "./clock/interface";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";
import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {IService} from "../node";
import {ChainEventEmitter} from "./emitter";

/**
 * The IBeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export interface IBeaconChain {
  emitter: ChainEventEmitter;
  forkChoice: ILMDGHOST;
  clock: IBeaconClock;
  chainId: Uint16;
  networkId: Uint64;
  currentForkDigest: ForkDigest;
  /**
   * Start beacon chain processing
   */
  start(): Promise<void>;

  /**
   * Stop beacon chain processing
   */
  stop(): Promise<void>;

  /**
   * Return ENRForkID.
   */
  getENRForkID(): Promise<ENRForkID>;
  getGenesisTime(): Number64;
  getHeadStateContext(): Promise<ITreeStateContext>;
  getHeadState(): Promise<BeaconState>;
  getHeadEpochContext(): Promise<EpochContext>;

  getHeadBlock(): Promise<SignedBeaconBlock | null>;

  getStateContextByBlockRoot(blockRoot: Root): Promise<ITreeStateContext | null>;

  getFinalizedCheckpoint(): Promise<Checkpoint>;

  /**
   * Since we can have multiple parallel chains,
   * this methods returns blocks in current chain head according to
   * forkchoice. Works for finalized slots as well
   * @param slot
   */
  getCanonicalBlockAtSlot(slot: Slot): Promise<SignedBeaconBlock | null>;

  getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<SignedBeaconBlock[] | null>;

  /**
   * Add attestation to the fork-choice rule
   */
  receiveAttestation(attestation: Attestation): Promise<void>;

  /**
   * Pre-process and run the per slot state transition function
   */
  receiveBlock(signedBlock: SignedBeaconBlock, trusted?: boolean): Promise<void>;

  /**
   * Initialize the chain with a genesis state
   */
  initializeBeaconChain(genesisState: TreeBacked<BeaconState>): Promise<void>;
}

export interface IAttestationProcessor extends IService {
  receiveBlock(signedBlock: SignedBeaconBlock, trusted?: boolean): Promise<void>;
  receiveAttestation(attestation: Attestation): Promise<void>;
  getPendingBlockAttestations(blockRootHex: string): Attestation[];
  getPendingSlotAttestations(slot: Slot): Attestation[];
}

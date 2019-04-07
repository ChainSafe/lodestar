import { Attestation, AttestationData, BeaconBlock, bytes32, Deposit, Shard, Slot, Eth1Data } from "../../types";

/**
 * The API interface defines the calls that can be made externally
 */
export interface API {
  /**
   * Return the current chain head
   */
  getChainHead(): Promise<BeaconBlock>;

  /**
   * Return a list of attestations ready for inclusion in the next block
   */
  getPendingAttestations(): Promise<Attestation[]>;

  /**
   * Return a list of deposits ready for inclusion in the next block
   */
  getPendingDeposits(): Promise<Deposit[]>;

  /**
   * Return the Eth1Data to be included in the next block
   */
  getEth1Data(): Promise<Eth1Data>;

  /**
   * Return the state root after the block has been run through the state transition
   */
  computeStateRoot(block: BeaconBlock): Promise<bytes32>;

  /**
   * Return the attestation data for a slot and shard based on the current head
   */
  getAttestationData(slot: Slot, shard: Shard): Promise<AttestationData>;

  /**
   * Submit an attestation for processing
   */
  putAttestation(attestation: Attestation): Promise<void>;

  /**
   * Submit a block for processing
   */
  putBlock(block: BeaconBlock): Promise<void>;
}

/**
 * @module opPool
 */

import {EventEmitter} from "events";

import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  Deposit,
  ProposerSlashing,
  Slot,
  Transfer,
  VoluntaryExit,
  BeaconBlockBody, number64
} from "../types";

import {BeaconChain} from "../chain";
import {BeaconDB} from "../db";
import {IOpPoolOptions} from "./options";

/**
 * Pool of operations not yet included on chain
 */
export class OpPool extends EventEmitter {
  private chain: BeaconChain;
  private db: BeaconDB;
  public constructor(opts: IOpPoolOptions, {chain, db}) {
    super();
    this.chain = chain;
    this.db = db;
  }

  /**
   * Start operation processing
   */
  public async start(): Promise<void> {
    this.chain.on('processedBlock', this.removeOperations.bind(this));
  }

  /**
   * Stop operation processing
   */
  public async stop(): Promise<void> {
    this.chain.removeListener('processedBlock', this.removeOperations.bind(this));
  }

  /**
   * Process incoming attestation
   */
  public async receiveAttestation(attestation: Attestation): Promise<void> {
    await this.db.setAttestation(attestation);
  }

  /**
   * Process incoming voluntary exit
   */
  public async receiveVoluntaryExit(exit: VoluntaryExit): Promise<void> {
    await this.db.setVoluntaryExit(exit);
  }

  /**
   * Process incoming transfer
   */
  public async receiveTransfer(transfer: Transfer): Promise<void> {
    await this.db.setTransfer(transfer);
  }

  /**
   * Process incoming proposer slashing
   */
  public async receiveProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void> {
    await this.db.setProposerSlashing(proposerSlashing);
  }

  /**
   * Process incoming attester slashing
   */
  public async receiveAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void> {
    await this.db.setAttesterSlashing(attesterSlashing);
  }

  /**
   * Return all stored attestations
   */
  public async getAttestations(): Promise<Attestation[]> {
    return await this.db.getAttestations();
  }

  /**
   * Return all stored voluntary exits
   */
  public async getVoluntaryExits(): Promise<VoluntaryExit[]> {
    return await this.db.getVoluntaryExits();
  }

  /**
   * Return all stored transfers
   */
  public async getTransfers(): Promise<Transfer[]> {
    return this.db.getTransfers();
  }

  /**
   * Return all stored proposer slashings
   */
  public async getProposerSlashings(): Promise<ProposerSlashing[]> {
    return await this.db.getProposerSlashings();
  }

  /**
   * Return all stored attester slashings
   */
  public async getAttesterSlashings(): Promise<AttesterSlashing[]> {
    return await this.db.getAttesterSlashings();
  }

  public async getDeposits(): Promise<Deposit[]> {
    return await this.db.getDeposits();
  }

  public async receiveDeposit(index: number, deposit: Deposit): Promise<void> {
    return await this.db.setDeposit(index, deposit);
  }

  /**
   * Remove stored operations based on a newly processed block
   */
  public async removeOperations(processedBlock: BeaconBlock): Promise<void> {
    const tasks = [
      this.removeAttestations(processedBlock.body.attestations),
      this.removeOldAttestations(processedBlock.slot),
      this.removeVoluntaryExits(processedBlock.body.voluntaryExits),
      this.removeOldDeposits(processedBlock.body.eth1Data.depositCount),
      this.removeOldTransfers(processedBlock.body.transfers),
      this.removeProposerSlashings(processedBlock.body.proposerSlashings),
      this.removeAttesterSlashings(processedBlock.body.attesterSlashings),
    ];
    await Promise.all(tasks);
  }

  private async removeAttestations(attestations: Attestation[]): Promise<void> {
    await this.db.deleteAttestations(attestations);
  }

  private async removeOldDeposits(depositCount: number64): Promise<void> {
    await this.db.deleteDeposits(depositCount);
  }

  private async removeOldAttestations(slot: Slot): Promise<void> {}

  private async removeVoluntaryExits(exits: VoluntaryExit[]): Promise<void> {
    await this.db.deleteVoluntaryExits(exits);
  }

  private async removeOldTransfers(transfers: Transfer[]): Promise<void> {
    await this.db.deleteTransfers(transfers);
  }

  private async removeProposerSlashings(proposerSlashings: ProposerSlashing[]): Promise<void> {
    await this.db.deleteProposerSlashings(proposerSlashings);
  }

  private async removeAttesterSlashings(attesterSlashings: AttesterSlashing[]): Promise<void> {
    await this.db.deleteAttesterSlashings(attesterSlashings);
  }
}

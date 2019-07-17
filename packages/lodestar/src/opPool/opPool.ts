/**
 * @module opPool
 */

import {EventEmitter} from "events";

import {BeaconBlock} from "@chainsafe/eth2-types";

import {BeaconChain} from "../chain";
import {BeaconDB} from "../db";
import {IOpPoolOptions} from "./options";
import {
  AttestationOperations,
  AttesterSlashingOperations,
  DepositsOperations,
  ProposerSlashingOperations,
  TransferOperations,
  VoluntaryExitOperations
} from "./modules";

/**
 * Pool of operations not yet included on chain
 */
export class OpPool extends EventEmitter {

  public attestations: AttestationOperations;
  public voluntaryExits: VoluntaryExitOperations;
  public deposits: DepositsOperations;
  public transfers: TransferOperations;
  public proposerSlashings: ProposerSlashingOperations;
  public attesterSlashings: AttesterSlashingOperations;

  private readonly chain: BeaconChain;
  private readonly db: BeaconDB;

  public constructor(opts: IOpPoolOptions, {chain, db}) {
    super();
    this.chain = chain;
    this.db = db;
    this.attestations = new AttestationOperations(this.db);
    this.voluntaryExits = new VoluntaryExitOperations(this.db);
    this.deposits = new DepositsOperations(this.db);
    this.transfers = new TransferOperations(this.db);
    this.proposerSlashings = new ProposerSlashingOperations(this.db);
    this.attesterSlashings = new AttesterSlashingOperations(this.db);
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
   * Remove stored operations based on a newly processed block
   */
  public async removeOperations(processedBlock: BeaconBlock): Promise<void> {
    const tasks = [
      this.voluntaryExits.remove(processedBlock.body.voluntaryExits),
      this.deposits.removeOld(processedBlock.body.eth1Data.depositCount),
      this.transfers.remove(processedBlock.body.transfers),
      this.proposerSlashings.remove(processedBlock.body.proposerSlashings),
      this.attesterSlashings.remove(processedBlock.body.attesterSlashings),
      //TODO: remove old attestations
    ];
    await Promise.all(tasks);
  }
}

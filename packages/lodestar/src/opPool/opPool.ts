/**
 * @module opPool
 */

import {EventEmitter} from "events";

import {Epoch, SignedBeaconBlock, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db";
import {IOpPoolOptions} from "./options";
import {
  AggregateAndProofOperations,
  AttestationOperations,
  AttesterSlashingOperations,
  DepositDataOperations,
  ProposerSlashingOperations,
  VoluntaryExitOperations
} from "./modules";
import {IEth1Notifier} from "../eth1";

interface IOpPoolModules {
  config: IBeaconConfig;
  eth1: IEth1Notifier;
  db: IBeaconDb;
}

/**
 * Pool of operations not yet included on chain
 */
export class OpPool extends EventEmitter {

  public attestations: AttestationOperations;
  public aggregateAndProofs: AggregateAndProofOperations;
  public voluntaryExits: VoluntaryExitOperations;
  public depositData: DepositDataOperations;
  public proposerSlashings: ProposerSlashingOperations;
  public attesterSlashings: AttesterSlashingOperations;

  private readonly config: IBeaconConfig;
  private readonly eth1: IEth1Notifier;
  private readonly db: IBeaconDb;
  private proposers: Map<Epoch, Map<ValidatorIndex, Slot>>;

  public constructor(opts: IOpPoolOptions, {config, eth1, db}: IOpPoolModules) {
    super();
    this.config = config;
    this.eth1 = eth1;
    this.db = db;
    this.proposers = new Map();
    this.attestations = new AttestationOperations(this.db.attestation, {config});
    this.aggregateAndProofs = new AggregateAndProofOperations(this.db.aggregateAndProof, {config});
    this.voluntaryExits = new VoluntaryExitOperations(this.db.voluntaryExit);
    this.depositData = new DepositDataOperations(this.db.depositData);
    this.proposerSlashings = new ProposerSlashingOperations(this.db.proposerSlashing);
    this.attesterSlashings = new AttesterSlashingOperations(this.db.attesterSlashing);
  }

  /**
   * Start operation processing
   */
  public async start(): Promise<void> {
    this.eth1.on("deposit", this.depositData.receive);
  }

  /**
   * Stop operation processing
   */
  public async stop(): Promise<void> {
    this.eth1.removeListener("deposit", this.depositData.receive);
  }

  /**
   * Remove stored operations based on a newly processed block
   */
  public async processBlockOperations(signedBlock: SignedBeaconBlock): Promise<void> {
    await Promise.all([
      this.voluntaryExits.remove(signedBlock.message.body.voluntaryExits),
      this.depositData.removeOld(signedBlock.message.body.eth1Data.depositCount),
      this.proposerSlashings.remove(signedBlock.message.body.proposerSlashings),
      this.attesterSlashings.remove(signedBlock.message.body.attesterSlashings),
      this.aggregateAndProofs.removeIncluded(signedBlock.message.body.attestations)
    ]);
  }
}

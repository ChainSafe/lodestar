/**
 * @module opPool
 */

import {EventEmitter} from "events";

import {BeaconBlock, BeaconState, Epoch, ProposerSlashing, Slot, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {blockToHeader, computeEpochOfSlot, getBeaconProposerIndex} from "../chain/stateTransition/util";
import {IBeaconDb} from "../db";
import {IOpPoolOptions} from "./options";
import {
  AttestationOperations,
  AttesterSlashingOperations,
  DepositsOperations,
  ProposerSlashingOperations,
  TransferOperations,
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
  public voluntaryExits: VoluntaryExitOperations;
  public deposits: DepositsOperations;
  public transfers: TransferOperations;
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
    this.attestations = new AttestationOperations(this.db.attestation, this.db.attestationData, {config});
    this.voluntaryExits = new VoluntaryExitOperations(this.db.voluntaryExit);
    this.deposits = new DepositsOperations(this.db.deposit);
    this.transfers = new TransferOperations(this.db.transfer);
    this.proposerSlashings = new ProposerSlashingOperations(this.db.proposerSlashing);
    this.attesterSlashings = new AttesterSlashingOperations(this.db.attesterSlashing);
  }

  /**
   * Start operation processing
   */
  public async start(): Promise<void> {
    this.eth1.on("deposit", this.deposits.receive);
  }

  /**
   * Stop operation processing
   */
  public async stop(): Promise<void> {
    this.eth1.removeListener("deposit", this.deposits.receive);
  }

  /**
   * Remove stored operations based on a newly processed block
   */
  public async processBlockOperations(processedBlock: BeaconBlock): Promise<void> {
    await Promise.all([
      this.voluntaryExits.remove(processedBlock.body.voluntaryExits),
      this.deposits.removeOld(processedBlock.body.eth1Data.depositCount),
      this.transfers.remove(processedBlock.body.transfers),
      this.proposerSlashings.remove(processedBlock.body.proposerSlashings),
      this.attesterSlashings.remove(processedBlock.body.attesterSlashings),
      this.attestations.remove(processedBlock.body.attestations),
      this.checkDuplicateProposer(processedBlock)
    ]);
  }

  public async checkDuplicateProposer(block: BeaconBlock): Promise<void> {
    const epoch: Epoch = computeEpochOfSlot(this.config, block.slot);
    const existingProposers: Map<ValidatorIndex, Slot> = this.proposers.get(epoch);
    const state: BeaconState = await this.db.state.getLatest();

    const proposerIndex: ValidatorIndex = await getBeaconProposerIndex(this.config, state);

    // Check if proposer already exists
    if (existingProposers && existingProposers.has(proposerIndex)) {
      const existingSlot: Slot = this.proposers.get(epoch).get(proposerIndex);
      const prevBlock: BeaconBlock = await this.db.block.getBlockBySlot(existingSlot);

      // Create slashing
      const slashing: ProposerSlashing = {
        proposerIndex: proposerIndex,
        header1: blockToHeader(this.config, prevBlock),
        header2: blockToHeader(this.config, block)
      };
      await this.proposerSlashings.receive(slashing);
    } else {
      const proposers: Map<ValidatorIndex, Slot> = new Map();
      proposers.set(proposerIndex, block.slot);
      this.proposers.set(epoch, proposers);
    }
    // TODO Prune map every so often
  }
}

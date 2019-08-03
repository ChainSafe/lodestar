/**
 * @module opPool
 */

import {EventEmitter} from "events";

import {BeaconBlock, BeaconBlockHeader, Epoch, ProposerSlashing, Slot, ValidatorIndex} from "../types";

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
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {computeEpochOfSlot} from "../chain/stateTransition/util";
import {hashTreeRoot} from "@chainsafe/ssz";

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
    this.attestations = new AttestationOperations(this.db.attestation, {config});
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
      this.attestations.remove(processedBlock.body.attestations)
    ]);
  }

  public async checkDuplicateProposer(config, block: BeaconBlock): Promise<void> {
    const epoch: Epoch = computeEpochOfSlot(config, block.slot);
    const proposers: Map<ValidatorIndex, Slot> = this.proposers.get(epoch);
    const proposerIndex: ValidatorIndex = await this.db.getValidatorIndex(block.signature);

    // Check if proposer already exists
    if (proposers.get(proposerIndex)) {
      const existingSlot: Slot = this.proposers.get(epoch).get(proposerIndex);
      const prevBlock: BeaconBlock = await this.db.block.getBlockBySlot(existingSlot);

      // Create slashing
      const slashing: ProposerSlashing = {
        proposerIndex: proposerIndex,
        header1: {
          stateRoot: prevBlock.stateRoot,
          signature: prevBlock.signature,
          slot: prevBlock.slot,
          parentRoot: prevBlock.parentRoot,
          bodyRoot: hashTreeRoot(prevBlock.body, config.types.BeaconBlockBody),
        },
        header2: {
          stateRoot: block.stateRoot,
          signature: block.signature,
          slot: block.slot,
          parentRoot: block.parentRoot,
          bodyRoot: hashTreeRoot(block.body, config.types.BeaconBlockBody),
        }
      };
      this.db.proposerSlashing.set(proposerIndex, slashing);
    } else {
      proposers.set(proposerIndex, block.slot);
    }
    // TODO Prune map every so often
  }
}

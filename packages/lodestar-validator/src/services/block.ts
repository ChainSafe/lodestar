/**
 * @module validator
 */

import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";

import {BeaconBlock, BeaconState, BLSPubkey, Epoch, Fork, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {computeEpochAtSlot, DomainType, getDomain} from "../util";
import {IValidatorDB} from "../";
import {ILogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {IApiClient} from "../api";

export default class BlockProposingService {

  private readonly config: IBeaconConfig;
  private readonly provider: IApiClient;
  private readonly privateKey: PrivateKey;
  private readonly publicKey: BLSPubkey;
  private readonly db: IValidatorDB;
  private readonly logger: ILogger;

  private nextProposalSlot: Slot|null = null;

  public constructor(
    config: IBeaconConfig,
    keypair: Keypair,
    provider: IApiClient,
    db: IValidatorDB,
    logger: ILogger
  ) {
    this.config = config;
    this.privateKey = keypair.privateKey;
    this.publicKey = keypair.publicKey.toBytesCompressed();
    this.provider = provider;
    this.db = db;
    this.logger = logger;
  }

  public start = async (): Promise<void> => {
    //trigger getting duties for current epoch
    const slot = this.provider.getCurrentSlot();
    this.onNewEpoch(computeEpochAtSlot(this.config, slot));
  };

  public onNewEpoch = async (epoch: Epoch): Promise<void> => {
    const epochProposers = await this.provider.validator.getProposerDuties(epoch);
    if(!epochProposers) {
      return;
    }
    Array.from(epochProposers.entries()).findIndex((epochProposerEntry: [Slot, BLSPubkey]) => {
      if(epochProposerEntry[1].equals(this.publicKey)) {
        this.nextProposalSlot = epochProposerEntry[0];
        return true;
      }
      return false;
    });
  };

  public onNewSlot = async(slot: Slot): Promise<void> => {
    if(this.nextProposalSlot === slot) {
      await this.createAndPublishBlock(slot, (await this.provider.beacon.getFork()).fork);
    }
  };

  /**
   * IFF a validator is selected construct a block to propose.
   */
  public async createAndPublishBlock(slot: Slot, fork: Fork): Promise<BeaconBlock | null> {
    if(await this.hasProposedAlready(slot)) {
      this.logger.info(`Already proposed block in current epoch: ${computeEpochAtSlot(this.config, slot)}`);
      return null;
    }
    this.logger.info(`Validator is proposer at slot ${slot}`);
    const block = await this.provider.validator.produceBlock(
      slot,
      this.privateKey.signMessage(
        hashTreeRoot(this.config.types.Epoch, computeEpochAtSlot(this.config, slot)),
        getDomain(this.config, {fork} as BeaconState, DomainType.RANDAO, computeEpochAtSlot(this.config, slot))
      ).toBytesCompressed()
    );
    if(!block) {
      return null;
    }
    block.signature = this.privateKey.signMessage(
      signingRoot(this.config.types.BeaconBlock, block),
      getDomain(this.config, {fork} as BeaconState, DomainType.BEACON_PROPOSER, computeEpochAtSlot(this.config, slot))
    ).toBytesCompressed();
    await this.storeBlock(block);
    await this.provider.validator.publishBlock(block);
    this.logger.info(
      `Proposed block with hash 0x${signingRoot(this.config.types.BeaconBlock, block).toString("hex")}`
    );
    return block;
  }

  public getRpcClient(): IApiClient {
    return this.provider;
  }

  private async hasProposedAlready(slot: Slot): Promise<boolean> {
    // get last proposed block from database and check if belongs in same epoch
    const lastProposedBlock = await this.db.getBlock(this.publicKey);
    if(!lastProposedBlock) return  false;
    return computeEpochAtSlot(this.config, lastProposedBlock.slot) === computeEpochAtSlot(this.config, slot);
  }

  private async storeBlock(block: BeaconBlock): Promise<void> {
    await this.db.setBlock(this.publicKey, block);
  }
}

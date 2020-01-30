/**
 * @module validator
 */

import {BeaconState, BLSPubkey, Epoch, Fork, Slot, SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {ILogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {toHex} from "@chainsafe/eth2.0-utils";
import {computeEpochAtSlot, DomainType, getDomain} from "../util";
import {IValidatorDB} from "../";
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

  public onNewEpoch = async (epoch: Epoch): Promise<void> => {
    const epochProposers = await this.provider.validator.getProposerDuties(epoch);
    epochProposers.forEach((validatorPubKey, slot) => {
      if(this.config.types.BLSPubkey.equals(validatorPubKey, this.publicKey)) {
        this.nextProposalSlot = slot;
      }
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
  public async createAndPublishBlock(slot: Slot, fork: Fork): Promise<SignedBeaconBlock | null> {
    if(await this.hasProposedAlready(slot)) {
      this.logger.info(`Already proposed block in current epoch: ${computeEpochAtSlot(this.config, slot)}`);
      return null;
    }
    this.logger.info(`Validator is proposer at slot ${slot}`);
    const block = await this.provider.validator.produceBlock(
      slot,
      this.privateKey.signMessage(
        this.config.types.Epoch.hashTreeRoot(computeEpochAtSlot(this.config, slot)),
        getDomain(this.config, {fork} as BeaconState, DomainType.RANDAO, computeEpochAtSlot(this.config, slot))
      ).toBytesCompressed()
    );
    if(!block) {
      return null;
    }
    const signedBlock: SignedBeaconBlock = {
      message: block,
      signature: this.privateKey.signMessage(
        this.config.types.BeaconBlock.hashTreeRoot(block),
        getDomain(this.config, {fork} as BeaconState, DomainType.BEACON_PROPOSER, computeEpochAtSlot(this.config, slot))
      ).toBytesCompressed(),
    };
    await this.storeBlock(signedBlock);
    await this.provider.validator.publishBlock(signedBlock);
    this.logger.info(
      `Proposed block with hash ${toHex(this.config.types.BeaconBlock.hashTreeRoot(block))}`
    );
    return signedBlock;
  }

  public getRpcClient(): IApiClient {
    return this.provider;
  }

  private async hasProposedAlready(slot: Slot): Promise<boolean> {
    // get last proposed block from database and check if belongs in same epoch
    const lastProposedBlock = await this.db.getBlock(this.publicKey);
    if(!lastProposedBlock) return  false;
    return computeEpochAtSlot(this.config, lastProposedBlock.message.slot) === computeEpochAtSlot(this.config, slot);
  }

  private async storeBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    await this.db.setBlock(this.publicKey, signedBlock);
  }
}

/**
 * @module validator
 */

import {BeaconState, BLSPubkey, Epoch, Fork, Slot, SignedBeaconBlock, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {toHexString} from "@chainsafe/ssz";
import {computeEpochAtSlot, DomainType, getDomain, computeSigningRoot}
  from "@chainsafe/lodestar-beacon-state-transition";
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
      if(this.config.types.BLSPubkey.equals(epochProposerEntry[1], this.publicKey)) {
        this.nextProposalSlot = epochProposerEntry[0];
        return true;
      }
      return false;
    });
  };

  public onNewSlot = async(slot: Slot): Promise<void> => {
    if(this.nextProposalSlot === slot) {
      const {fork, genesisValidatorsRoot} = await this.provider.beacon.getFork();
      await this.createAndPublishBlock(slot, fork, genesisValidatorsRoot);
    }
  };

  /**
   * IFF a validator is selected construct a block to propose.
   */
  public async createAndPublishBlock(
    slot: Slot, fork: Fork, genesisValidatorsRoot: Root): Promise<SignedBeaconBlock | null> {
    if(await this.hasProposedAlready(slot)) {
      this.logger.info(`Already proposed block in current epoch: ${computeEpochAtSlot(this.config, slot)}`);
      return null;
    }
    this.logger.info(`Validator is proposer at slot ${slot}`);
    const epoch = computeEpochAtSlot(this.config, slot);
    const randaoDomain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.RANDAO,
      epoch
    );
    const randaoSigningRoot = computeSigningRoot(this.config, this.config.types.Epoch, epoch, randaoDomain);
    const block = await this.provider.validator.produceBlock(
      slot,
      this.publicKey,
      this.privateKey.signMessage(
        randaoSigningRoot
      ).toBytesCompressed()
    );
    if(!block) {
      return null;
    }
    const proposerDomain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.BEACON_PROPOSER,
      computeEpochAtSlot(this.config, slot)
    );
    const blockSigningRoot = computeSigningRoot(this.config, this.config.types.BeaconBlock, block, proposerDomain);

    const signedBlock: SignedBeaconBlock = {
      message: block,
      signature: this.privateKey.signMessage(blockSigningRoot).toBytesCompressed(),
    };
    await this.storeBlock(signedBlock);
    await this.provider.validator.publishBlock(signedBlock);
    this.logger.info(
      `Proposed block with hash ${toHexString(this.config.types.BeaconBlock.hashTreeRoot(block))}`
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

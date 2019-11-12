/**
 * @module validator
 */

import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";

import {BeaconBlock, BeaconState, Fork, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {Keypair} from "@chainsafe/bls";
import {computeEpochAtSlot, DomainType, getDomain} from "../util";
import {IValidatorDB,ILogger} from "../";
import {IApiClient} from "../api";


export default class BlockProposingService {
  private config: IBeaconConfig;
  // @ts-ignore
  private provider: IApiClient;
  private keypair: Keypair;
  private db: IValidatorDB;
  private logger: ILogger;

  public constructor(
    config: IBeaconConfig,
    keypair: Keypair,
    provider: IApiClient,
    db: IValidatorDB,
    logger: ILogger
  ) {
    this.config = config;
    this.keypair = keypair;
    this.provider = provider;
    this.db = db;
    this.logger = logger;
  }

  /**
   * IFF a validator is selected construct a block to propose.
   */
  public async createAndPublishBlock(slot: Slot, fork: Fork): Promise<BeaconBlock | null> {
    if(await this.hasProposedAlready(slot)) {
      this.logger.info(`[Validator] Already proposed block in current epoch: ${computeEpochAtSlot(this.config, slot)}`);
      return null;
    }
    const block = await this.provider.validator.produceBlock(
      slot,
      this.keypair.privateKey.signMessage(
        hashTreeRoot(computeEpochAtSlot(this.config, slot), this.config.types.Epoch),
        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        getDomain(this.config, {fork} as BeaconState, DomainType.RANDAO, computeEpochAtSlot(this.config, slot))
      ).toBytesCompressed()
    );
    if(!block) {
      return null;
    }
    block.signature = this.keypair.privateKey.signMessage(
      signingRoot(block, this.config.types.BeaconBlock),
      // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
      getDomain(this.config, {fork} as BeaconState, DomainType.BEACON_PROPOSER, computeEpochAtSlot(this.config, slot))
    ).toBytesCompressed();
    await this.storeBlock(block);
    await this.provider.validator.publishBlock(block);
    this.logger.info(
      `Proposed block with hash 0x${signingRoot(block, this.config.types.BeaconBlock).toString("hex")}`
    );
    return block;
  }

  public getRpcClient(): IApiClient {
    return this.provider;
  }

  private async hasProposedAlready(slot: Slot): Promise<boolean> {
    // get last proposed block from database and check if belongs in same epoch
    const lastProposedBlock = await this.db.getBlock(this.keypair.publicKey.toBytesCompressed());
    if(!lastProposedBlock) return  false;
    return computeEpochAtSlot(this.config, lastProposedBlock.slot) === computeEpochAtSlot(this.config, slot);
  }

  private async storeBlock(block: BeaconBlock): Promise<void> {
    await this.db.setBlock(this.keypair.publicKey.toBytesCompressed(), block);
  }
}

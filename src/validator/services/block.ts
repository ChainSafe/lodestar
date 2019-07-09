/**
 * @module validator
 */

import {BeaconBlock, Epoch, Fork, Slot, ValidatorIndex} from "../../types";
import {getDomainFromFork, slotToEpoch} from "../../chain/stateTransition/util";
import {RpcClient} from "../rpc";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {Domain} from "../../constants";
import {IValidatorDB} from "../../db";
import {ILogger} from "../../logger";

export default class BlockProposingService {
  private validatorIndex: ValidatorIndex;
  private provider: RpcClient;
  private privateKey: PrivateKey;
  private db: IValidatorDB;
  private logger: ILogger;

  public constructor(
    index: ValidatorIndex,
    provider: RpcClient,
    privateKey: PrivateKey,
    db: IValidatorDB,
    logger: ILogger
  ) {
    this.validatorIndex = index;
    this.provider = provider;
    this.privateKey = privateKey;
    this.db = db;
    this.logger = logger;
  }

  /**
   * IFF a validator is selected construct a block to propose.
   */
  public async createAndPublishBlock(slot: Slot, fork: Fork): Promise<BeaconBlock> {
    if(await this.hasProposedAlready(slot)) {
      this.logger.info(`[Validator] Already proposed block in current epoch: ${slotToEpoch(slot)}`);
      return null;
    }
    const block = await this.provider.validator.produceBlock(
      slot,
      this.privateKey.signMessage(
        hashTreeRoot(slotToEpoch(slot), Epoch),
        getDomainFromFork(fork, slotToEpoch(slot), Domain.RANDAO)
      ).toBytesCompressed()
    );
    block.signature = this.privateKey.signMessage(
      signingRoot(block, BeaconBlock),
      getDomainFromFork(fork, slotToEpoch(slot), Domain.BEACON_PROPOSER)
    ).toBytesCompressed();
    await this.storeBlock(block);
    await this.provider.validator.publishBlock(block);
    this.logger.info(
      `[Validator] Proposed block with hash 0x${hashTreeRoot(block, BeaconBlock).toString('hex')}`
    );
    return block;
  }

  public getRpcClient(): RpcClient {
    return this.provider;
  }

  private async hasProposedAlready(slot: Slot): Promise<boolean> {
    const lastProposedBlock = await this.db.getBlock(this.validatorIndex);
    // get last proposed block from database and check if belongs in same epoch
    return lastProposedBlock && slotToEpoch(lastProposedBlock.slot) === slotToEpoch(slot);
  }

  private async storeBlock(block: BeaconBlock): Promise<void> {
    await this.db.setBlock(this.validatorIndex, block);
  }
}

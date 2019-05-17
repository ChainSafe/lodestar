/**
 * @module validator
 */

import {BeaconBlock, Fork, Slot, ValidatorIndex} from "../../types";
import {getDomainFromFork, getRandaoMix, slotToEpoch} from "../../chain/stateTransition/util";
import {RpcClient} from "../rpc";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {Domain} from "../../constants";
import logger from "../../logger";
import {IValidatorDB} from "../../db";

export default class BlockProposingService {
  private validatorIndex: ValidatorIndex;
  private provider: RpcClient;
  private privateKey: PrivateKey;
  private db: IValidatorDB;

  public constructor(
    index: ValidatorIndex,
    provider: RpcClient,
    privateKey: PrivateKey,
    db: IValidatorDB
  ) {
    this.validatorIndex = index;
    this.provider = provider;
    this.privateKey = privateKey;
    this.db = db;
  }

  /**
   * IFF a validator is selected construct a block to propose.
   */
  public async createAndPublishBlock(slot: Slot, fork: Fork): Promise<BeaconBlock> {
    if(await this.hasProposedAlready(slot)) {
      logger.info(`[Validator] Already proposed block in current epoch: ${slotToEpoch(slot)}`);
      return null;
    }
    const block = await this.provider.validator.produceBlock(
      slot,
      getRandaoMix(
        await this.provider.beacon.getBeaconState(),
        slotToEpoch(slot)
      )
    );
    block.signature = this.privateKey.signMessage(
      signingRoot(block, BeaconBlock),
      getDomainFromFork(fork, slotToEpoch(slot), Domain.BEACON_PROPOSER)
    ).toBytesCompressed();
    await this.storeBlock(block);
    await this.provider.validator.publishBlock(block);
    logger.info(
      `[Validator] Proposed block with hash 0x${hashTreeRoot(block, BeaconBlock).toString('hex')}`
    );
    return block;
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

/**
 * @module validator
 */

import {PrivateKey} from "@chainsafe/bls/lib/privateKey";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";

import {BeaconBlock, Epoch, Fork, Slot, ValidatorIndex, BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {getDomain, computeEpochOfSlot} from "../../chain/stateTransition/util";
import {RpcClient} from "../rpc";
import {DomainType} from "../../constants";
import {IValidatorDB} from "../../db";
import {ILogger} from "../../logger";

export default class BlockProposingService {
  private config: IBeaconConfig;
  private validatorIndex: ValidatorIndex;
  private provider: RpcClient;
  private privateKey: PrivateKey;
  private db: IValidatorDB;
  private logger: ILogger;

  public constructor(
    config: IBeaconConfig,
    index: ValidatorIndex,
    provider: RpcClient,
    privateKey: PrivateKey,
    db: IValidatorDB,
    logger: ILogger
  ) {
    this.config = config;
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
      this.logger.info(`[Validator] Already proposed block in current epoch: ${computeEpochOfSlot(this.config, slot)}`);
      return null;
    }
    const block = await this.provider.validator.produceBlock(
      slot,
      this.privateKey.signMessage(
        hashTreeRoot(computeEpochOfSlot(this.config, slot), this.config.types.Epoch),
        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        getDomain(this.config, {fork} as BeaconState, DomainType.RANDAO, computeEpochOfSlot(this.config, slot))
      ).toBytesCompressed()
    );
    block.signature = this.privateKey.signMessage(
      signingRoot(block, this.config.types.BeaconBlock),
      // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
      getDomain(this.config, {fork} as BeaconState, DomainType.BEACON_PROPOSER, computeEpochOfSlot(this.config, slot))
    ).toBytesCompressed();
    await this.storeBlock(block);
    await this.provider.validator.publishBlock(block);
    this.logger.info(
      `[Validator] Proposed block with hash 0x${hashTreeRoot(block, this.config.types.BeaconBlock).toString('hex')}`
    );
    return block;
  }

  public getRpcClient(): RpcClient {
    return this.provider;
  }

  private async hasProposedAlready(slot: Slot): Promise<boolean> {
    const lastProposedBlock = await this.db.getBlock(this.validatorIndex);
    // get last proposed block from database and check if belongs in same epoch
    return lastProposedBlock && computeEpochOfSlot(this.config, lastProposedBlock.slot) === computeEpochOfSlot(this.config, slot);
  }

  private async storeBlock(block: BeaconBlock): Promise<void> {
    await this.db.setBlock(this.validatorIndex, block);
  }
}

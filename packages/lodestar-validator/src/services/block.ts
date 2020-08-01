/**
 * @module validator
 */

import {
  BeaconState,
  BLSPubkey,
  Epoch,
  Fork,
  ProposerDuty,
  Root,
  SignedBeaconBlock,
  Slot
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {toHexString} from "@chainsafe/ssz";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  DomainType,
  getDomain
} from "@chainsafe/lodestar-beacon-state-transition";
import {IValidatorDB} from "../";
import {IApiClient} from "../api";

export default class BlockProposingService {

  private readonly config: IBeaconConfig;
  private readonly provider: IApiClient;
  //validators private keys (order is important)
  private readonly privateKeys: PrivateKey[] = [];
  //validators public keys (order is important)
  private readonly publicKeys: BLSPubkey[] = [];
  private readonly db: IValidatorDB;
  private readonly logger: ILogger;
  private readonly graffiti?: string;

  private nextProposals: Map<Slot, BLSPubkey> = new Map();

  public constructor(
    config: IBeaconConfig,
    keypairs: Keypair[],
    provider: IApiClient,
    db: IValidatorDB,
    logger: ILogger,
    graffiti?: string
  ) {
    this.config = config;
    keypairs.forEach((keypair) => {
      this.privateKeys.push(keypair.privateKey);
      this.publicKeys.push(keypair.publicKey.toBytesCompressed());
    });
    this.provider = provider;
    this.db = db;
    this.logger = logger;
    this.graffiti = graffiti;
  }

  public start = async (): Promise<void> => {
    //trigger getting duties for current epoch
    const slot = this.provider.getCurrentSlot();
    await this.onNewEpoch(computeEpochAtSlot(this.config, slot));
  };

  public onNewEpoch = async (epoch: Epoch): Promise<void> => {
    this.logger.info("on new block epoch", {epoch, validator: toHexString(this.publicKeys[0])});
    let proposerDuties: ProposerDuty[];
    try {
      proposerDuties = await this.provider.validator.getProposerDuties(epoch, this.publicKeys);
    } catch (e) {
      this.logger.error("Failed to obtain proposer duties", e);
    }
    if(!proposerDuties) {
      return;
    }
    proposerDuties.forEach((duty) => {
      if(!this.nextProposals.has(duty.slot) && this.getPubKeyIndex(duty.proposerPubkey) !== -1) {
        this.logger.debug("Next proposer duty", {slot: duty.slot, validator: toHexString(duty.proposerPubkey)});
        this.nextProposals.set(duty.slot, duty.proposerPubkey);
      }
    });
  };

  public onNewSlot = async(slot: Slot): Promise<void> => {
    if(computeStartSlotAtEpoch(this.config, computeEpochAtSlot(this.config, slot)) === slot) {
      await this.onNewEpoch(computeEpochAtSlot(this.config, slot));
    }
    const proposerPubKey = this.nextProposals.get(slot);
    if(proposerPubKey && slot !== 0) {
      this.nextProposals.delete(slot);
      this.logger.info(
        "Validator is proposer!",
        {
          slot,
          validator: toHexString(proposerPubKey)
        }
      );
      const {fork, genesisValidatorsRoot} = await this.provider.beacon.getFork();
      await this.createAndPublishBlock(
        this.getPubKeyIndex(proposerPubKey),
        slot,
        fork,
        genesisValidatorsRoot
      );
    }
  };

  /**
   * IFF a validator is selected construct a block to propose.
   */
  public async createAndPublishBlock(
    proposerIndex: number, slot: Slot, fork: Fork, genesisValidatorsRoot: Root): Promise<SignedBeaconBlock | null> {
    if(await this.hasProposedAlready(proposerIndex, slot)) {
      this.logger.info(`Already proposed block in current epoch: ${computeEpochAtSlot(this.config, slot)}`);
      return null;
    }
    const epoch = computeEpochAtSlot(this.config, slot);
    const randaoDomain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.RANDAO,
      epoch
    );
    const randaoSigningRoot = computeSigningRoot(this.config, this.config.types.Epoch, epoch, randaoDomain);
    let block;
    try {
      block = await this.provider.validator.produceBlock(
        slot,
        this.publicKeys[proposerIndex],
        this.privateKeys[proposerIndex].signMessage(
          randaoSigningRoot
        ).toBytesCompressed(),
        this.graffiti || ""
      );
    } catch (e) {
      this.logger.error(`Failed to produce block for slot ${slot}`, e);
    }
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
      signature: this.privateKeys[proposerIndex].signMessage(blockSigningRoot).toBytesCompressed(),
    };
    await this.storeBlock(proposerIndex, signedBlock);
    try {
      await this.provider.validator.publishBlock(signedBlock);
      this.logger.info(
        `Proposed block with hash ${toHexString(this.config.types.BeaconBlock.hashTreeRoot(block))} and slot ${slot}`
      );
    } catch (e) {
      this.logger.error(`Failed to publish block for slot ${slot}`, e);
    }
    return signedBlock;
  }

  public getRpcClient(): IApiClient {
    return this.provider;
  }

  private async hasProposedAlready(proposerIndex: number, slot: Slot): Promise<boolean> {
    // get last proposed block from database and check if belongs in same slot
    const lastProposedBlock = await this.db.getBlock(this.publicKeys[proposerIndex]);
    if(!lastProposedBlock) return  false;
    return this.config.types.Slot.equals(lastProposedBlock.message.slot, slot);
  }

  private async storeBlock(proposerIndex: number, signedBlock: SignedBeaconBlock): Promise<void> {
    await this.db.setBlock(this.publicKeys[proposerIndex], signedBlock);
  }

  private getPubKeyIndex(search: BLSPubkey): number {
    return this.publicKeys.findIndex((pubkey) => {
      return this.config.types.BLSPubkey.equals(pubkey, search);
    });
  }
}

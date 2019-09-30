/**
 * @module api/rpc
 */

import {Attestation, BeaconBlock, BLSPubkey, bytes96, Epoch, Shard, Slot, ValidatorDuty} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IBeaconDb} from "../../../../db";
import {IBeaconChain} from "../../../../chain";
import {OpPool} from "../../../../opPool";
import {IValidatorApi} from "./interface";
import {assembleBlock} from "../../../../chain/factory/block";
import {IEth1Notifier} from "../../../../eth1";
import {getValidatorDuties, produceAttestation} from "../../../impl/validator";
import {ApiNamespace, IApiModules} from "../../../index";
import {IApiOptions} from "../../../options";
import {ILogger} from "../../../../logger";
import {hashTreeRoot} from "@chainsafe/ssz";

export class ValidatorApi implements IValidatorApi {

  public namespace: ApiNamespace;

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private db: IBeaconDb;
  private opPool: OpPool;
  private eth1: IEth1Notifier;
  private logger: ILogger;

  public constructor(
    opts: Partial<IApiOptions>,
    {config, chain, db, opPool, eth1, logger}: Pick<IApiModules, "config"|"chain"|"db"|"opPool"|"eth1"|"logger">
  ) {
    this.namespace = ApiNamespace.VALIDATOR;
    this.config = config;
    this.chain = chain;
    this.db = db;
    this.logger = logger;
    this.opPool = opPool;
    this.eth1 = eth1;
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes96): Promise<BeaconBlock> {
    return await assembleBlock(this.config, this.chain, this.db, this.opPool, this.eth1, slot, randaoReveal);
  }

  public async getDuties(validatorPublicKeys: BLSPubkey[], epoch: Epoch): Promise<ValidatorDuty[]> {
    return getValidatorDuties(this.config, this.db, validatorPublicKeys, epoch);
  }

  public async produceAttestation(
    validatorPubKey: BLSPubkey,
    pocBit: boolean,
    slot: Slot,
    shard: Shard
  ): Promise<Attestation> {
    try {
      return await produceAttestation(
        {config: this.config, chain: this.chain, db: this.db},
        validatorPubKey,
        shard,
        slot
      );
    } catch (e) {
      this.logger.warn(`Failed to produce attestation because: ${e.message}`);
    }
  }

  public async publishBlock(block: BeaconBlock): Promise<void> {
    await this.chain.receiveBlock(block);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    if (!await this.opPool.attestations.verifyAndReceive(this.chain.latestState, attestation)) {
      const attestationHash = hashTreeRoot(attestation, this.config.types.Attestation);
      this.logger.error(`Cannot verify attestation ${attestationHash.toString("hex")}`);
    }
  }

  public async getValidatorIndex(pubKey: BLSPubkey): Promise<number> {
    return this.db.getValidatorIndex(pubKey);
  }

}

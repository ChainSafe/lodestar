/**
 * @module api/rpc
 */

import {
  AggregateAndProof,
  Attestation,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  bytes96,
  CommitteeIndex,
  Epoch,
  SignedBeaconBlock,
  Slot,
  ValidatorDuty
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IBeaconDb} from "../../../../db";
import {IBeaconChain} from "../../../../chain";
import {OpPool} from "../../../../opPool";
import {IValidatorApi} from "./interface";
import {assembleBlock} from "../../../../chain/factory/block";
import {IEth1Notifier} from "../../../../eth1";
import {getAttesterDuties, getEpochProposers, produceAttestation, publishAttestation} from "../../../impl/validator";
import {ApiNamespace, IApiModules} from "../../../index";
import {IApiOptions} from "../../../options";
import {ILogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {INetwork} from "../../../../network";
import {getDomain, isAggregator} from "@chainsafe/eth2.0-state-transition";
import {verify} from "@chainsafe/bls";
import {hashTreeRoot} from "@chainsafe/ssz";
import {computeEpochAtSlot, DomainType} from "@chainsafe/lodestar-validator/lib/util";
import {Sync} from "../../../../sync";

export class ValidatorApi implements IValidatorApi {

  public namespace: ApiNamespace;

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private db: IBeaconDb;
  private network: INetwork;
  private sync: Sync;
  private opPool: OpPool;
  private eth1: IEth1Notifier;
  private logger: ILogger;

  public constructor(
    opts: Partial<IApiOptions>,
    modules: Pick<IApiModules, "config"|"chain"|"db"|"opPool"|"eth1"|"sync"|"network"|"logger">
  ) {
    this.namespace = ApiNamespace.VALIDATOR;
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
    this.network = modules.network;
    this.sync = modules.sync;
    this.logger = modules.logger;
    this.opPool = modules.opPool;
    this.eth1 = modules.eth1;
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes96): Promise<BeaconBlock> {
    return await assembleBlock(this.config, this.chain, this.db, this.opPool, this.eth1, slot, randaoReveal);
  }

  public async produceAttestation(
    validatorPubKey: BLSPubkey,
    pocBit: boolean,
    index: CommitteeIndex,
    slot: Slot,
  ): Promise<Attestation> {
    try {
      return await produceAttestation(
        {config: this.config, chain: this.chain, db: this.db},
        validatorPubKey,
        index,
        slot
      );
    } catch (e) {
      this.logger.warn(`Failed to produce attestation because: ${e.message}`);
    }
  }

  public async publishBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    await this.chain.receiveBlock(signedBlock);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    await publishAttestation(attestation, this.network.gossip, this.opPool.attestations);
  }

  public async getProposerDuties(epoch: Epoch): Promise<Map<Slot, BLSPubkey>> {
    return getEpochProposers(this.config, this.chain, this.db, epoch);
  }

  public async getAttesterDuties(epoch: number, validatorPubKeys: Buffer[]): Promise<ValidatorDuty[]> {
    return getAttesterDuties(this.config, this.db, this.chain, epoch, validatorPubKeys);
  }

  public async publishAggregatedAttestation(
    aggregated: Attestation,
    validatorPubkey: BLSPubkey,
    slotSignature: BLSSignature
  ): Promise<void> {
    const aggregation: AggregateAndProof = {
      aggregate: aggregated,
      selectionProof: slotSignature,
      aggregatorIndex: await this.db.getValidatorIndex(validatorPubkey)
    };
    await Promise.all([
      this.opPool.aggregateAndProofs.receive(aggregation),
      this.network.gossip.publishAggregatedAttestation(aggregation)
    ]);
  }

  public async getWireAttestations(epoch: number, committeeIndex: number): Promise<Attestation[]> {
    return await this.opPool.attestations.getCommiteeAttestations(epoch, committeeIndex);
  }

  public async isAggregator(slot: Slot, committeeIndex: CommitteeIndex, slotSignature: BLSSignature): Promise<boolean> {
    return isAggregator(this.config, await this.db.state.getLatest(), slot, committeeIndex, slotSignature);
  }

  public async subscribeCommitteeSubnet(
    slot: Slot, slotSignature: BLSSignature, committeeIndex: CommitteeIndex, aggregatorPubkey: BLSPubkey
  ): Promise<void> {
    const valid = verify(
      aggregatorPubkey,
      hashTreeRoot(this.config.types.Slot, slot),
      slotSignature,
      getDomain(
        this.config,
        this.chain.latestState,
        DomainType.BEACON_ATTESTER,
        computeEpochAtSlot(this.config, slot))
    );
    if(!valid) {
      throw new Error("Ivalid slot signature");
    }
    this.sync.regularSync.collectAttestations(
      slot,
      committeeIndex
    );
  }

}

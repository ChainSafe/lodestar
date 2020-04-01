/**
 * @module api/rpc
 */

import {
  AggregateAndProof,
  Attestation,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  Bytes96,
  CommitteeIndex,
  Epoch,
  SignedBeaconBlock,
  Slot,
  ValidatorDuty
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../../db";
import {IBeaconChain} from "../../../chain";
import {OpPool} from "../../../opPool";
import {IValidatorApi} from "./interface";
import {assembleBlock} from "../../../chain/factory/block";
import {IEth1Notifier} from "../../../eth1";
import {ApiNamespace, IApiModules} from "../../index";
import {IApiOptions} from "../../options";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {INetwork} from "../../../network";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBeaconProposerIndex,
  getDomain,
  isAggregator,
  processSlots,
  computeSigningRoot
} from "@chainsafe/lodestar-beacon-state-transition";
import {verify} from "@chainsafe/bls";
import {Sync} from "../../../sync";
import {DomainType} from "../../../constants";
import {assembleValidatorDuty} from "../../../chain/factory/duties";
import assert from "assert";
import {assembleAttestation} from "../../../chain/factory/attestation";

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

  public async produceBlock(slot: Slot, randaoReveal: Bytes96): Promise<BeaconBlock> {
    return await assembleBlock(this.config, this.chain, this.db, this.opPool, this.eth1, slot, randaoReveal);
  }

  public async produceAttestation(
    validatorPubKey: BLSPubkey,
    pocBit: boolean,
    index: CommitteeIndex,
    slot: Slot,
  ): Promise<Attestation> {
    try {
      let subscribeFunc: (block: SignedBeaconBlock) => Promise<void>;
      await new Promise((resolve) => {
        setTimeout(resolve, this.config.params.SECONDS_PER_SLOT / 3 * 1000);
        subscribeFunc = async (block: SignedBeaconBlock): Promise<void> => {
          if (block.message.slot === slot) {
            resolve();
          }
        };
        this.chain.on("processedBlock", subscribeFunc);
      });
      if (subscribeFunc) {
        this.chain.removeListener("processedBlock", subscribeFunc);
      }

      const [headBlock, headState, validatorIndex] = await Promise.all([
        this.db.block.get(this.chain.forkChoice.head()),
        this.db.state.get(this.chain.forkChoice.headStateRoot()),
        this.db.getValidatorIndex(validatorPubKey)
      ]);
      processSlots(this.config, headState, slot);
      return await assembleAttestation(
        {config: this.config, db: this.db},
        headState,
        headBlock.message,
        validatorIndex,
        index,
        slot
      );
    } catch (e) {
      this.logger.warn(`Failed to produce attestation because: ${e.message}`);
    }
  }

  public async publishBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    await Promise.all([
      this.chain.receiveBlock(signedBlock),
      this.network.gossip.publishBlock(signedBlock)
    ]);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    await Promise.all([
      this.network.gossip.publishCommiteeAttestation(attestation),
      this.opPool.attestations.receive(attestation)
    ]);
  }

  public async getProposerDuties(epoch: Epoch): Promise<Map<Slot, BLSPubkey>> {
    const state = await this.db.state.get(this.chain.forkChoice.headStateRoot());
    assert(epoch >= 0 && epoch <= computeEpochAtSlot(this.config, state.slot) + 2);
    const startSlot = computeStartSlotAtEpoch(this.config, epoch);
    if(state.slot < startSlot) {
      processSlots(this.config, state, startSlot);
    }
    const slotProposerMapping: Map<Slot, BLSPubkey> = new Map();

    for(let slot = startSlot; slot < startSlot + this.config.params.SLOTS_PER_EPOCH; slot ++) {
      const blockProposerIndex = getBeaconProposerIndex(this.config, {...state, slot});
      slotProposerMapping.set(slot, state.validators[blockProposerIndex].pubkey);
    }
    return slotProposerMapping;
  }

  public async getAttesterDuties(epoch: number, validatorPubKeys: BLSPubkey[]): Promise<ValidatorDuty[]> {
    const state = await this.db.state.get(this.chain.forkChoice.headStateRoot());

    const validatorIndexes = await Promise.all(validatorPubKeys.map(async publicKey => {
      return  state.validators.findIndex((v) => this.config.types.BLSPubkey.equals(v.pubkey, publicKey));
    }));

    return validatorIndexes.map((validatorIndex) => {
      return assembleValidatorDuty(
        this.config,
        {publicKey: state.validators[validatorIndex].pubkey, index: validatorIndex},
        state,
        epoch
      );
    });
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
    const domain = getDomain(
      this.config,
      this.chain.latestState,
      DomainType.BEACON_ATTESTER,
      computeEpochAtSlot(this.config, slot));
    const signingRoot = computeSigningRoot(this.config, this.config.types.Slot, slot, domain);
    const valid = verify(
      aggregatorPubkey.valueOf() as Uint8Array,
      signingRoot,
      slotSignature.valueOf() as Uint8Array,
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

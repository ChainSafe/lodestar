/**
 * @module api/rpc
 */

import {
  AggregateAndProof,
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  Bytes96,
  CommitteeIndex,
  Epoch,
  ProposerDuty,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot
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
  computeSigningRoot,
  computeStartSlotAtEpoch,
  getBeaconProposerIndex,
  getDomain,
  processSlots
} from "@chainsafe/lodestar-beacon-state-transition";
import {Signature, verify} from "@chainsafe/bls";
import {DomainType, EMPTY_SIGNATURE} from "../../../constants";
import {assembleAttesterDuty} from "../../../chain/factory/duties";
import assert from "assert";
import {assembleAttestation} from "../../../chain/factory/attestation";
import {IBeaconSync} from "../../../sync";
import {getCommitteeIndexSubnet} from "../../../network/gossip/utils";

export class ValidatorApi implements IValidatorApi {

  public namespace: ApiNamespace;

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private db: IBeaconDb;
  private network: INetwork;
  private sync: IBeaconSync;
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

  public async produceBlock(slot: Slot, validatorPubkey: BLSPubkey, randaoReveal: Bytes96): Promise<BeaconBlock> {
    const validatorIndex = await this.db.getValidatorIndex(validatorPubkey);
    return await assembleBlock(
      this.config, this.chain, this.db, this.opPool, this.eth1, slot, validatorIndex, randaoReveal
    );
  }

  public async produceAttestation(
    validatorPubKey: BLSPubkey,
    index: CommitteeIndex,
    slot: Slot,
  ): Promise<Attestation> {
    try {
      const [headBlock, headState, validatorIndex] = await Promise.all([
        this.chain.getHeadBlock(),
        this.chain.getHeadState(),
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

  public async getProposerDuties(epoch: Epoch): Promise<ProposerDuty[]> {
    const state = await this.chain.getHeadState();
    assert(epoch >= 0 && epoch <= computeEpochAtSlot(this.config, state.slot) + 2);
    const startSlot = computeStartSlotAtEpoch(this.config, epoch);
    if(state.slot < startSlot) {
      processSlots(this.config, state, startSlot);
    }
    const duties: ProposerDuty[] = [];

    for(let slot = startSlot; slot < startSlot + this.config.params.SLOTS_PER_EPOCH; slot ++) {
      const blockProposerIndex = getBeaconProposerIndex(this.config, {...state, slot});
      duties.push({slot, proposerPubkey: state.validators[blockProposerIndex].pubkey});
    }
    return duties;
  }

  public async getAttesterDuties(epoch: number, validatorPubKeys: BLSPubkey[]): Promise<AttesterDuty[]> {
    const state = await this.chain.getHeadState();

    const validatorIndexes = await Promise.all(validatorPubKeys.map(async publicKey => {
      return  state.validators.findIndex((v) => this.config.types.BLSPubkey.equals(v.pubkey, publicKey));
    }));

    return validatorIndexes.map((validatorIndex) => {
      return assembleAttesterDuty(
        this.config,
        {publicKey: state.validators[validatorIndex].pubkey, index: validatorIndex},
        state,
        epoch
      );
    });
  }

  public async publishAggregateAndProof(
    signedAggregateAndProof: SignedAggregateAndProof,
  ): Promise<void> {
    await Promise.all([
      this.opPool.aggregateAndProofs.receive(signedAggregateAndProof.message),
      this.network.gossip.publishAggregatedAttestation(signedAggregateAndProof)
    ]);
  }

  public async getWireAttestations(epoch: number, committeeIndex: number): Promise<Attestation[]> {
    return await this.opPool.attestations.getCommiteeAttestations(epoch, committeeIndex);
  }


  public async produceAggregateAndProof(
    attestationData: AttestationData, aggregator: BLSPubkey
  ): Promise<AggregateAndProof> {
    const attestations = (await this.getWireAttestations(
      computeEpochAtSlot(this.config, attestationData.slot),
      attestationData.index
    )
    );
    const aggregate = attestations.filter((a) => {
      return this.config.types.AttestationData.equals(a.data, attestationData);
    }).reduce((current, attestation) => {
      try {
        current.signature = Signature
          .fromCompressedBytes(current.signature.valueOf() as Uint8Array)
          .add(Signature.fromCompressedBytes(attestation.signature.valueOf() as Uint8Array))
          .toBytesCompressed();
        let index = 0;
        for(const bit of attestation.aggregationBits) {
          if(bit) {
            current.aggregationBits[index] = true;
          }
          index++;
        }
      } catch (e) {
        //ignored
      }
      return current;
    });
    return {
      aggregate,
      aggregatorIndex: await this.db.getValidatorIndex(aggregator),
      selectionProof: EMPTY_SIGNATURE
    };
  }

  public async subscribeCommitteeSubnet(
    slot: Slot, slotSignature: BLSSignature, committeeIndex: CommitteeIndex, aggregatorPubkey: BLSPubkey
  ): Promise<void> {
    const domain = getDomain(
      this.config,
      await this.chain.getHeadState(),
      DomainType.SELECTION_PROOF,
      computeEpochAtSlot(this.config, slot));
    const signingRoot = computeSigningRoot(this.config, this.config.types.Slot, slot, domain);
    const valid = verify(
      aggregatorPubkey.valueOf() as Uint8Array,
      signingRoot,
      slotSignature.valueOf() as Uint8Array,
    );
    if(!valid) {
      throw new Error("Invalid slot signature");
    }
    this.sync.collectAttestations(
      slot,
      committeeIndex
    );
    const subnet = getCommitteeIndexSubnet(committeeIndex);
    await this.network.searchSubnetPeers(subnet);
  }

}

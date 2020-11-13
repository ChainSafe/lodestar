/**
 * @module api/rpc
 */

import bls, {Signature} from "@chainsafe/bls";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  computeSubnetForSlot,
  getDomain,
} from "@chainsafe/lodestar-beacon-state-transition";
import {computeSubnetForAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/attestation";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
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
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {assert, ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IAttestationJob, IBeaconChain, IBlockJob} from "../../../chain";
import {AttestationError, AttestationErrorCode} from "../../../chain/errors";
import {assembleAttestation} from "../../../chain/factory/attestation";
import {assembleBlock} from "../../../chain/factory/block";
import {assembleAttesterDuty} from "../../../chain/factory/duties";
import {
  validateGossipAggregateAndProof,
  validateGossipAttestation,
  validateGossipBlock,
} from "../../../chain/validation";
import {DomainType, EMPTY_SIGNATURE} from "../../../constants";
import {IBeaconDb} from "../../../db";
import {IEth1ForBlockProduction} from "../../../eth1";
import {INetwork} from "../../../network";
import {IBeaconSync} from "../../../sync";
import {toGraffitiBuffer} from "../../../util/graffiti";
import {notNullish} from "../../../util/notNullish";
import {IApiOptions} from "../../options";
import {ApiNamespace, IApiModules} from "../interface";
import {checkSyncStatus} from "../utils";
import {IValidatorApi} from "./interface";
import {ApiError} from "../errors/api";

export class ValidatorApi implements IValidatorApi {
  public namespace: ApiNamespace;

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private db: IBeaconDb;
  private eth1: IEth1ForBlockProduction;
  private network: INetwork;
  private sync: IBeaconSync;
  private logger: ILogger;

  public constructor(
    opts: Partial<IApiOptions>,
    modules: Pick<IApiModules, "config" | "chain" | "db" | "eth1" | "sync" | "network" | "logger">
  ) {
    this.namespace = ApiNamespace.VALIDATOR;
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
    this.eth1 = modules.eth1;
    this.network = modules.network;
    this.sync = modules.sync;
    this.logger = modules.logger;
  }

  public async produceBlock(
    slot: Slot,
    validatorPubkey: BLSPubkey,
    randaoReveal: Bytes96,
    graffiti = ""
  ): Promise<BeaconBlock> {
    await checkSyncStatus(this.config, this.sync);
    const validatorIndex = (await this.chain.getHeadEpochContext()).pubkey2index.get(validatorPubkey);
    if (validatorIndex === undefined) {
      throw Error(`Validator pubKey ${toHexString(validatorPubkey)} not in epochCtx`);
    }
    return await assembleBlock(
      this.config,
      this.chain,
      this.db,
      this.eth1,
      slot,
      validatorIndex,
      randaoReveal,
      toGraffitiBuffer(graffiti)
    );
  }

  public async produceAttestation(validatorPubKey: BLSPubkey, index: CommitteeIndex, slot: Slot): Promise<Attestation> {
    try {
      await checkSyncStatus(this.config, this.sync);
      const headRoot = this.chain.forkChoice.getHeadRoot();
      const {state, epochCtx} = await this.chain.regen.getBlockSlotState(headRoot, slot);
      const validatorIndex = epochCtx.pubkey2index.get(validatorPubKey);
      if (validatorIndex === undefined) {
        throw Error(`Validator pubKey ${toHexString(validatorPubKey)} not in epochCtx`);
      }
      return await assembleAttestation(epochCtx, state, headRoot, validatorIndex, index, slot);
    } catch (e) {
      this.logger.warn(`Failed to produce attestation because: ${e.message}`);
      throw e;
    }
  }

  public async publishBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    await checkSyncStatus(this.config, this.sync);
    const blockJob = {
      signedBlock: signedBlock,
      trusted: false,
      reprocess: false,
    } as IBlockJob;
    await validateGossipBlock(this.config, this.chain, this.db, blockJob);
    await Promise.all([this.chain.receiveBlock(signedBlock), this.network.gossip.publishBlock(signedBlock)]);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    await checkSyncStatus(this.config, this.sync);
    const attestationJob = {
      attestation,
      validSignature: false,
    } as IAttestationJob;
    let attestationPreStateContext;
    try {
      attestationPreStateContext = await this.chain.regen.getCheckpointState(attestation.data.target);
    } catch (e) {
      throw new AttestationError({
        code: AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE,
        job: attestationJob,
      });
    }
    const subnet = computeSubnetForAttestation(this.config, attestationPreStateContext.epochCtx, attestation);
    await validateGossipAttestation(this.config, this.chain, this.db, attestationJob, subnet);
    await Promise.all([
      this.network.gossip.publishCommiteeAttestation(attestation),
      this.db.attestation.add(attestation),
    ]);
  }

  public async getProposerDuties(epoch: Epoch): Promise<ProposerDuty[]> {
    await checkSyncStatus(this.config, this.sync);
    assert.gte(epoch, 0, "Epoch must be positive");
    assert.lte(epoch, this.chain.clock.currentEpoch, "Must get proposer duties in current epoch");
    const {state, epochCtx} = await this.chain.getHeadStateContextAtCurrentEpoch();
    const startSlot = computeStartSlotAtEpoch(this.config, epoch);
    const duties: ProposerDuty[] = [];

    for (let slot = startSlot; slot < startSlot + this.config.params.SLOTS_PER_EPOCH; slot++) {
      const blockProposerIndex = epochCtx.getBeaconProposer(slot);
      duties.push({slot, validatorIndex: blockProposerIndex, pubkey: state.validators[blockProposerIndex].pubkey});
    }
    return duties;
  }

  public async getAttesterDuties(epoch: number, validatorIndices: ValidatorIndex[]): Promise<AttesterDuty[]> {
    await checkSyncStatus(this.config, this.sync);
    if (validatorIndices.length === 0) throw new ApiError(400, "No validator to get attester duties");
    if (epoch > this.chain.clock.currentEpoch + 1)
      throw new ApiError(400, "Cannot get duties for epoch more than one ahead");
    const {epochCtx, state} = await this.chain.getHeadStateContextAtCurrentEpoch();
    return validatorIndices
      .map((validatorIndex) => {
        const validator = state.validators[validatorIndex];
        if (!validator) {
          throw new ApiError(400, `Validator index ${validatorIndex} not in state`);
        }
        return assembleAttesterDuty(this.config, {pubkey: validator.pubkey, index: validatorIndex}, epochCtx, epoch);
      })
      .filter(notNullish) as AttesterDuty[];
  }

  public async publishAggregateAndProof(signedAggregateAndProof: SignedAggregateAndProof): Promise<void> {
    await checkSyncStatus(this.config, this.sync);
    const attestation = signedAggregateAndProof.message.aggregate;
    const attestationJob = {
      attestation: attestation,
      validSignature: false,
    } as IAttestationJob;
    await validateGossipAggregateAndProof(this.config, this.chain, this.db, signedAggregateAndProof, attestationJob);
    await Promise.all([
      this.db.aggregateAndProof.add(signedAggregateAndProof.message),
      this.db.seenAttestationCache.addAggregateAndProof(signedAggregateAndProof.message),
      this.network.gossip.publishAggregatedAttestation(signedAggregateAndProof),
    ]);
  }

  public async getWireAttestations(epoch: number, committeeIndex: number): Promise<Attestation[]> {
    return await this.db.attestation.getCommiteeAttestations(epoch, committeeIndex);
  }

  public async produceAggregateAndProof(
    attestationData: AttestationData,
    aggregator: BLSPubkey
  ): Promise<AggregateAndProof> {
    await checkSyncStatus(this.config, this.sync);
    const attestations = await this.getWireAttestations(
      computeEpochAtSlot(this.config, attestationData.slot),
      attestationData.index
    );
    const epochCtx = await this.chain.getHeadEpochContext();
    const matchingAttestations = attestations.filter((a) => {
      return this.config.types.AttestationData.equals(a.data, attestationData);
    });

    if (matchingAttestations.length === 0) {
      throw Error("No matching attestations found for attestationData");
    }

    const aggregatorIndex = epochCtx.pubkey2index.get(aggregator);
    if (aggregatorIndex === undefined) {
      throw Error(`Aggregator pubkey ${toHexString(aggregator)} not in epochCtx`);
    }

    const aggregate = matchingAttestations.reduce((current, attestation) => {
      try {
        current.signature = Signature.fromCompressedBytes(current.signature.valueOf() as Uint8Array)
          .add(Signature.fromCompressedBytes(attestation.signature.valueOf() as Uint8Array))
          .toBytesCompressed();
        let index = 0;
        for (const bit of attestation.aggregationBits) {
          if (bit) {
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
      aggregatorIndex,
      selectionProof: EMPTY_SIGNATURE,
    };
  }

  public async subscribeCommitteeSubnet(
    slot: Slot,
    slotSignature: BLSSignature,
    committeeIndex: CommitteeIndex,
    aggregatorPubkey: BLSPubkey
  ): Promise<void> {
    await checkSyncStatus(this.config, this.sync);
    const state = await this.chain.getHeadState();
    const domain = getDomain(this.config, state, DomainType.SELECTION_PROOF, computeEpochAtSlot(this.config, slot));
    const signingRoot = computeSigningRoot(this.config, this.config.types.Slot, slot, domain);
    const valid = bls.verify(
      aggregatorPubkey.valueOf() as Uint8Array,
      signingRoot,
      slotSignature.valueOf() as Uint8Array
    );
    if (!valid) {
      throw new Error("Invalid slot signature");
    }
    await this.sync.collectAttestations(slot, committeeIndex);
    const subnet = computeSubnetForSlot(this.config, state, slot, committeeIndex);
    await this.network.searchSubnetPeers(String(subnet));
  }
}

/**
 * @module rpc/api
 */

import {
  Attestation,
  AttestationData,
  BeaconBlock,
  BeaconState, BLSPubkey,
  bytes96,
  Crosslink,
  Epoch,
  IndexedAttestation,
  Shard,
  Slot,
  ValidatorDuty,
  ValidatorIndex
} from "../../../types";
import {BeaconDB} from "../../../db";
import {BeaconChain} from "../../../chain";
import {OpPool} from "../../../opPool";
import {IValidatorApi} from "./interface";
import {
  getBeaconProposerIndex,
  getBlockRoot,
  getCommitteeAssignment,
  getCurrentEpoch,
  getEpochStartSlot,
  isProposerAtSlot,
  slotToEpoch
} from "../../../chain/stateTransition/util";
import {CommitteeAssignment} from "../../../validator/types";
import {assembleBlock} from "../../../chain/blockAssembly";
import {advanceSlot} from "../../../chain/stateTransition";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {ZERO_HASH} from "../../../constants";

export class ValidatorApi implements IValidatorApi {

  public namespace: string;
  private chain: BeaconChain;
  private db: BeaconDB;
  private opPool: OpPool;

  public constructor(opts, {chain, db, opPool}) {
    this.namespace = "validator";
    this.chain = chain;
    this.db = db;
    this.opPool = opPool;
  }

  public async produceBlock(slot: Slot, randaoReveal: bytes96): Promise<BeaconBlock> {
    return await assembleBlock(this.db, this.opPool, slot, randaoReveal);
  }

  public async isProposer(index: ValidatorIndex, slot: Slot): Promise<boolean> {
    const state: BeaconState = await this.db.getState();
    return isProposerAtSlot(state, slot, index);
  }

  public async getDuties(validatorPublicKeys: Buffer[]): Promise<ValidatorDuty[]> {
    const state = await this.db.getState();

    const validatorIndexes = await Promise.all(validatorPublicKeys.map(async publicKey => {
      return  await this.db.getValidatorIndex(publicKey);
    }));

    const proposerIndex = getBeaconProposerIndex(state);
    const validatorProposer = validatorIndexes.indexOf(proposerIndex);

    return validatorPublicKeys.map((publicKey, index) => {
      let duty: ValidatorDuty = {
        validatorPubkey: publicKey,
        blockProductionSlot: null,
        attestationShard: null,
        attestationSlot: null,
        committeeIndex: null
      };
      const comitteeAsignment = getCommitteeAssignment(
        state,
        slotToEpoch(state.slot),
        validatorIndexes[index]
      );
      if (comitteeAsignment) {
        duty = {
          ...duty,
          attestationShard: comitteeAsignment.shard,
          attestationSlot: comitteeAsignment.slot,
          committeeIndex: comitteeAsignment.validators.indexOf(validatorIndexes[index])
        };
      }
      if (validatorPublicKeys.indexOf(duty.validatorPubkey) === validatorProposer) {
        duty = {
          ...duty,
          blockProductionSlot: state.slot
        };
      }
      return duty;
    });
  }

  public async getCommitteeAssignment(index: ValidatorIndex, epoch: Epoch): Promise<CommitteeAssignment> {
    const state: BeaconState = await this.db.getState();
    return getCommitteeAssignment(state, epoch, index);
  }

  public async produceAttestation(slot: Slot, shard: Shard): Promise<IndexedAttestation> {
    const [headState, headBlock] = await Promise.all([
      this.db.getState(),
      this.db.getBlock(this.chain.forkChoice.head())
    ]);
    while(headState.slot < slot) {
      advanceSlot(headState);
    }
    return {
      custodyBit0Indices: [],
      custodyBit1Indices: [],
      data: await this.assebmleAttestationData(headState, headBlock, shard),
      signature: undefined
    };
  }

  public async publishBlock(block: BeaconBlock): Promise<void> {
    await this.chain.receiveBlock(block);
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    await this.opPool.receiveAttestation(attestation);
  }

  public async getIndex(validatorPublicKey: BLSPubkey): Promise<ValidatorIndex> {
    return await this.db.getValidatorIndex(validatorPublicKey);
  }

  private async assebmleAttestationData(
    headState: BeaconState,
    headBlock: BeaconBlock,
    shard: Shard): Promise<AttestationData> {

    const currentEpoch = getCurrentEpoch(headState);
    const epochStartSlot = getEpochStartSlot(currentEpoch);
    let epochBoundaryBlock: BeaconBlock;
    if(epochStartSlot === headState.slot) {
      epochBoundaryBlock = headBlock;
    } else {
      epochBoundaryBlock = await this.db.getBlock(getBlockRoot(headState, epochStartSlot));
    }
    return  {
      beaconBlockRoot: signingRoot(headBlock, BeaconBlock),
      crosslinkDataRoot: ZERO_HASH,
      previousCrosslinkRoot: hashTreeRoot(headState.currentCrosslinks[shard], Crosslink),
      shard,
      sourceEpoch: headState.currentJustifiedEpoch,
      sourceRoot: headState.currentJustifiedRoot,
      targetEpoch: currentEpoch,
      targetRoot: signingRoot(epochBoundaryBlock, BeaconBlock)
    };
  }
}

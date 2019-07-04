/**
 * @module validator/attestation
 */
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {hashTreeRoot} from "@chainsafe/ssz";

import {
  Attestation,
  AttestationData,
  AttestationDataAndCustodyBit,
  Fork,
  Shard,
  Slot,
  ValidatorIndex
} from "../../types";
import {BeaconConfig} from "../../config";

import {
  getDomainFromFork,
  isSlashableAttestationData,
  slotToEpoch
} from "../../chain/stateTransition/util";

import {RpcClient} from "../rpc";

import {Domain} from "../../constants";
import {intDiv} from "../../util/math";
import {IValidatorDB} from "../../db/api";
import {ILogger} from "../../logger";

export class AttestationService {

  private config: BeaconConfig;
  private validatorIndex: ValidatorIndex;
  private rpcClient: RpcClient;
  private privateKey: PrivateKey;
  private db: IValidatorDB;
  private logger: ILogger;

  public constructor(
    config: BeaconConfig,
    validatorIndex: ValidatorIndex,
    rpcClient: RpcClient,
    privateKey: PrivateKey,
    db: IValidatorDB,
    logger: ILogger
  ) {
    this.config = config;
    this.validatorIndex = validatorIndex;
    this.rpcClient = rpcClient;
    this.privateKey = privateKey;
    this.db = db;
    this.logger = logger;
  }


  public async createAndPublishAttestation(
    slot: Slot,
    shard: Shard,
    fork: Fork): Promise<Attestation> {
    const indexedAttestation = await this.rpcClient.validator.produceAttestation(slot, shard);
    if (await this.isConflictingAttestation(indexedAttestation.data)) {
      this.logger.warn(
        `[Validator] Avoided signing conflicting attestation! `
        + `Source epoch: ${indexedAttestation.data.sourceEpoch}, Target epoch: ${slotToEpoch(this.config, slot)}`
      );
      return null;
    }
    const attestationDataAndCustodyBit: AttestationDataAndCustodyBit = {
      custodyBit: false,
      data: indexedAttestation.data
    };
    const attestation = await this.createAttestation(attestationDataAndCustodyBit, fork, slot);
    await this.storeAttestation(attestation);
    await this.rpcClient.validator.publishAttestation(attestation);
    this.logger.info(`[Validator] Signed and publish new attestation`);
    return attestation;
  }

  private async isConflictingAttestation(other: AttestationData): Promise<boolean> {
    const potentialAttestationConflicts =
      await this.db.getAttestations(this.validatorIndex, {gt: other.targetEpoch - 1});
    return potentialAttestationConflicts.some((attestation => {
      return isSlashableAttestationData(this.config, attestation.data, other);
    }));
  }

  private async storeAttestation(attestation: Attestation): Promise<void> {
    await this.db.setAttestation(this.validatorIndex, attestation);

    //cleanup
    const unusedAttestations =
      await this.db.getAttestations(this.validatorIndex, {gt: 0, lt: attestation.data.targetEpoch});
    await this.db.deleteAttestations(this.validatorIndex, unusedAttestations);
  }

  private async createAttestation(
    attestationDataAndCustodyBit: AttestationDataAndCustodyBit,
    fork: Fork,
    slot: Slot
  ): Promise<Attestation> {
    const signature = this.privateKey.signMessage(
      hashTreeRoot(attestationDataAndCustodyBit, this.config.types.AttestationDataAndCustodyBit),
      getDomainFromFork(
        fork,
        slotToEpoch(this.config, slot),
        Domain.ATTESTATION
      )
    ).toBytesCompressed();
    const committeeAssignment =
      await this.rpcClient.validator.getCommitteeAssignment(this.validatorIndex, slotToEpoch(this.config, slot));
    const indexInCommittee =
      committeeAssignment.validators
        .findIndex(value => value === this.validatorIndex);
    const aggregationBitfield = Buffer.alloc(committeeAssignment.validators.length + 7, 0);
    aggregationBitfield[intDiv(indexInCommittee, 8)] = Math.pow(2, indexInCommittee % 8);
    return {
      data: attestationDataAndCustodyBit.data,
      signature,
      custodyBitfield: Buffer.alloc(committeeAssignment.validators.length + 7, 0),
      aggregationBitfield
    };
  }
}

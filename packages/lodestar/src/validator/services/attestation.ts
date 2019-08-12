/**
 * @module validator/attestation
 */
import {PrivateKey} from "@chainsafe/bls/lib/privateKey";
import {hashTreeRoot} from "@chainsafe/ssz";
import {BitList} from "@chainsafe/bit-utils";

import {
  Attestation,
  AttestationData,
  AttestationDataAndCustodyBit,
  Fork,
  Shard,
  Slot,
  ValidatorIndex,
  BeaconState
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  isSlashableAttestationData,
  computeEpochOfSlot,
  getDomain,
} from "../../chain/stateTransition/util";

import {RpcClient} from "../rpc";

import {DomainType} from "../../constants";
import {intDiv} from "../../util/math";
import {IValidatorDB} from "../../db/api";
import {ILogger} from "../../logger";

export class AttestationService {

  private config: IBeaconConfig;
  private validatorIndex: ValidatorIndex;
  private rpcClient: RpcClient;
  private privateKey: PrivateKey;
  private db: IValidatorDB;
  private logger: ILogger;

  public constructor(
    config: IBeaconConfig,
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
        + `Source epoch: ${indexedAttestation.data.source.epoch}, Target epoch: ${computeEpochOfSlot(this.config, slot)}`
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
      await this.db.getAttestations(this.validatorIndex, {gt: other.target.epoch - 1});
    return potentialAttestationConflicts.some((attestation => {
      return isSlashableAttestationData(this.config, attestation.data, other);
    }));
  }

  private async storeAttestation(attestation: Attestation): Promise<void> {
    await this.db.setAttestation(this.validatorIndex, attestation);

    //cleanup
    const unusedAttestations =
      await this.db.getAttestations(this.validatorIndex, {gt: 0, lt: attestation.data.target.epoch});
    await this.db.deleteAttestations(this.validatorIndex, unusedAttestations);
  }

  private async createAttestation(
    attestationDataAndCustodyBit: AttestationDataAndCustodyBit,
    fork: Fork,
    slot: Slot
  ): Promise<Attestation> {
    const signature = this.privateKey.signMessage(
      hashTreeRoot(attestationDataAndCustodyBit, this.config.types.AttestationDataAndCustodyBit),
      getDomain(
        this.config,
        {fork} as BeaconState, // eslint-disable-line @typescript-eslint/no-object-literal-type-assertion
        DomainType.ATTESTATION,
        computeEpochOfSlot(this.config, slot),
      )
    ).toBytesCompressed();
    const committeeAssignment =
      await this.rpcClient.validator.getCommitteeAssignment(this.validatorIndex, computeEpochOfSlot(this.config, slot));
    const indexInCommittee =
      committeeAssignment.validators
        .findIndex(value => value === this.validatorIndex);
    const committeeLength = committeeAssignment.validators.length;
    const aggregationBits = BitList.fromBitfield(Buffer.alloc(intDiv(committeeLength + 7, 8)), committeeLength);
    aggregationBits.setBit(indexInCommittee, true);
    const custodyBits = BitList.fromBitfield(Buffer.alloc(intDiv(committeeLength + 7, 8)), committeeLength);
    return {
      data: attestationDataAndCustodyBit.data,
      signature,
      custodyBits,
      aggregationBits,
    };
  }
}

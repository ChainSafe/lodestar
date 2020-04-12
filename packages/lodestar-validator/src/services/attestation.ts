/**
 * @module validator/attestation
 */
import {
  Attestation,
  AttestationData,
  BeaconState,
  BLSPubkey,
  BLSSignature,
  CommitteeIndex,
  Epoch,
  Fork,
  Slot
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IApiClient} from "../api";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {IValidatorDB} from "..";
import {toHexString} from "@chainsafe/ssz";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  DomainType,
  getDomain,
  isSlashableAttestationData,
} from "@chainsafe/lodestar-beacon-state-transition";

import {sleep} from "../util";
import {IAttesterDuty} from "../types";
import {isValidatorAggregator} from "../util/aggregator";

export class AttestationService {

  private readonly config: IBeaconConfig;
  private readonly provider: IApiClient;
  private readonly privateKey: PrivateKey;
  private readonly publicKey: BLSPubkey;
  private readonly db: IValidatorDB;
  private readonly logger: ILogger;

  private nextAttesterDuties: Map<Slot, IAttesterDuty> = new Map<Slot, IAttesterDuty>();

  public constructor(
    config: IBeaconConfig,
    keypair: Keypair,
    rpcClient: IApiClient,
    db: IValidatorDB,
    logger: ILogger
  ) {
    this.config = config;
    this.provider = rpcClient;
    this.privateKey = keypair.privateKey;
    this.publicKey = keypair.publicKey.toBytesCompressed();
    this.db = db;
    this.logger = logger;
  }

  public start = async (): Promise<void> => {
    const slot = this.provider.getCurrentSlot();
    //trigger getting duties for current epoch
    this.onNewEpoch(computeEpochAtSlot(this.config, slot) - 1);
  };

  public onNewEpoch = async (epoch: Epoch): Promise<void> => {
    const attesterDuties = await this.provider.validator.getAttesterDuties(epoch + 1, [this.publicKey]);
    if (
      attesterDuties && attesterDuties.length === 1 &&
            this.config.types.BLSPubkey.equals(attesterDuties[0].validatorPubkey, this.publicKey)
    ) {
      const duty = attesterDuties[0];
      const fork = (await this.provider.beacon.getFork()).fork;
      const slotSignature = this.getSlotSignature(duty.attestationSlot, fork);
      const isAggregator = isValidatorAggregator(slotSignature, duty.aggregatorModulo);
      this.nextAttesterDuties.set(
        duty.attestationSlot,
        {
          ...duty,
          isAggregator
        });
      if (isAggregator) {
        await this.provider.validator.subscribeCommitteeSubnet(
          duty.attestationSlot,
          slotSignature,
          duty.committeeIndex,
          this.publicKey
        );
      }
    }
  };

  public onNewSlot = async (slot: Slot): Promise<void> => {
    const duty = this.nextAttesterDuties.get(slot);
    if (duty) {
      await sleep(this.config.params.SECONDS_PER_SLOT / 3 * 1000);
      const fork = (await this.provider.beacon.getFork()).fork;
      const attestation = await this.createAttestation(duty.attestationSlot, duty.committeeIndex, fork);
      if (!attestation) {
        return;
      }
      if (duty.isAggregator) {
        setTimeout(
          this.aggregateAttestations,
          this.config.params.SECONDS_PER_SLOT / 3 * 1000,
          duty, attestation, fork
        );
      }
      await this.provider.validator.publishAttestation(attestation);
      this.logger.info(
        `Published new attestation for block ${toHexString(attestation.data.target.root)} ` +
                `and committee ${duty.committeeIndex} at slot ${slot}`
      );
    }
  };

  private aggregateAttestations = async (duty: IAttesterDuty, attestation: Attestation, fork: Fork): Promise<void> => {
    this.logger.info(
      `Aggregating attestations for committee ${duty.committeeIndex} at slot ${duty.attestationSlot}`
    );
    const aggregatedAttestation = await this.provider.validator.produceAggregatedAttestation(attestation.data);
    await this.provider.validator.publishAggregatedAttestation(
      {
        aggregate: aggregatedAttestation,
        selectionProof: this.getSlotSignature(
          duty.attestationSlot,
          fork
        ),
        aggregatorIndex: (await (this.provider.beacon.getValidator(this.publicKey))).index
      }
    );
    this.logger.info(
      `Published aggregated attestation for committee ${duty.committeeIndex} at slot ${duty.attestationSlot}`
    );
  };

  private getSlotSignature(slot: Slot, fork: Fork): BLSSignature {
    const domain = getDomain(
      this.config,
      {fork} as BeaconState,
      DomainType.BEACON_ATTESTER,
      computeEpochAtSlot(this.config, slot)
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.Slot, slot, domain);
    return this.privateKey.signMessage(signingRoot).toBytesCompressed();
  }

  private async createAttestation(
    slot: Slot,
    committeeIndex: CommitteeIndex,
    fork: Fork): Promise<Attestation> {
    const attestation = await this.provider.validator.produceAttestation(
      this.publicKey,
      committeeIndex,
      slot
    );
    if (!attestation) {
      this.logger.warn(`Failed to obtain attestation from beacon node at slot ${slot} and committee ${committeeIndex}`);
      return null;
    }
    if (await this.isConflictingAttestation(attestation.data)) {
      this.logger.warn(
        "Avoided signing conflicting attestation! "
                + `Source epoch: ${attestation.data.source.epoch}, `
                + `Target epoch: ${computeEpochAtSlot(this.config, slot)}`
      );
      return null;
    }
    const domain = getDomain(
      this.config,
      {fork} as BeaconState,
      DomainType.BEACON_ATTESTER,
      attestation.data.target.epoch,
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.AttestationData, attestation.data, domain);
    attestation.signature = this.privateKey.signMessage(
      signingRoot
    ).toBytesCompressed();
    await this.storeAttestation(attestation);
    this.logger.info(
      `Signed new attestation for block ${toHexString(attestation.data.target.root)} ` +
            `and committee ${committeeIndex} at slot ${slot}`
    );
    return attestation;
  }

  private async isConflictingAttestation(other: AttestationData): Promise<boolean> {
    const potentialAttestationConflicts =
            await this.db.getAttestations(this.publicKey, {gt: other.target.epoch - 1});
    return potentialAttestationConflicts.some((attestation => {
      return isSlashableAttestationData(this.config, attestation.data, other);
    }));
  }

  private async storeAttestation(attestation: Attestation): Promise<void> {
    await this.db.setAttestation(this.publicKey, attestation);

    //cleanup
    const unusedAttestations =
            await this.db.getAttestations(
              this.publicKey,
              {gt: 0, lt: attestation.data.target.epoch}
            );
    await this.db.deleteAttestations(this.publicKey, unusedAttestations);
  }
}

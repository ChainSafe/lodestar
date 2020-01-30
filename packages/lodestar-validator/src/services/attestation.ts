/**
 * @module validator/attestation
 */
import {equals, hashTreeRoot} from "@chainsafe/ssz";

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
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IApiClient} from "../api";
import {aggregateSignatures, Keypair, PrivateKey} from "@chainsafe/bls";
import {IValidatorDB} from "..";
import {ILogger} from "@chainsafe/eth2.0-utils/lib/logger";

import {computeEpochAtSlot, DomainType, getDomain, isSlashableAttestationData, sleep} from "../util";
import {IAttesterDuty} from "../types";

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
    if(attesterDuties.length === 1 && attesterDuties[0].validatorPubkey.equals(this.publicKey)) {
      const duty = attesterDuties[0];
      const fork = (await this.provider.beacon.getFork()).fork;
      const isAggregator = await this.provider.validator.isAggregator(
        duty.attestationSlot,
        duty.committeeIndex,
        this.getSlotSignature(duty.attestationSlot, fork)
      );
      this.nextAttesterDuties.set(
        duty.attestationSlot,
        {
          ...duty,
          isAggregator
        });
      if(isAggregator) {
        //TODO: subscribe to committee subnet
      }
    }
  };

  public onNewSlot = async (slot: Slot): Promise<void> => {
    const duty = this.nextAttesterDuties.get(slot);
    if(duty) {
      await sleep(this.config.params.SECONDS_PER_SLOT / 3 * 1000);
      const fork = (await this.provider.beacon.getFork()).fork;
      const attestation = await this.createAttestation(duty.attestationSlot, duty.committeeIndex, fork);
      if(!attestation) {
        return;
      }
      if(duty.isAggregator) {
        setTimeout(
          this.aggregateAttestations,
          this.config.params.SECONDS_PER_SLOT / 3 * 1000,
          duty, attestation, fork
        );
      }
      await this.provider.validator.publishAttestation(attestation);
      this.logger.info(
        `Published new attestation for block ${attestation.data.target.root.toString("hex")} ` +
          `and committee ${duty.committeeIndex} at slot ${slot}`
      );
    }
  };

  private aggregateAttestations = async (duty: IAttesterDuty, attestation: Attestation, fork: Fork): Promise<void> => {
    this.logger.info(
      `Aggregating attestations for committee ${duty.committeeIndex} at slot ${duty.attestationSlot}`
    );
    const wireAttestations = await this.provider.validator.getWireAttestations(
      computeEpochAtSlot(this.config, duty.attestationSlot),
      duty.committeeIndex
    );
    if(wireAttestations.length === 0) {
      this.logger.warn(
        `No attestations to aggregate for slot ${duty.attestationSlot} and committee ${duty.committeeIndex}`
      );
    }

    const compatibleAttestations = wireAttestations.filter((wireAttestation) => {
      return equals(this.config.types.AttestationData, wireAttestation.data, attestation.data)
                    // prevent including aggregator attestation twice
                    && ! equals(this.config.types.Attestation, attestation, wireAttestation);
    });
    compatibleAttestations.push(attestation);
    const aggregatedAttestation: Attestation = {
      signature: aggregateSignatures(compatibleAttestations.map((a) => a.signature)),
      data: attestation.data,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      aggregationBits: compatibleAttestations.reduce((aggregatedBits, current) => {
        return aggregatedBits.or(current.aggregationBits);
      }, compatibleAttestations[0].aggregationBits)
    };
    await this.provider.validator.publishAggregatedAttestation(
      aggregatedAttestation,
      this.publicKey,
      this.getSlotSignature(
        duty.attestationSlot,
        fork
      )
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
    return this.privateKey.signMessage(hashTreeRoot(this.config.types.Slot, slot), domain).toBytesCompressed();
  }

  private async createAttestation(
    slot: Slot,
    committeeIndex: CommitteeIndex,
    fork: Fork): Promise<Attestation> {
    const attestation = await this.provider.validator.produceAttestation(
      this.publicKey,
      false,
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
                +`Target epoch: ${computeEpochAtSlot(this.config, slot)}`
      );
      return null;
    }
    attestation.signature = this.privateKey.signMessage(
      hashTreeRoot(this.config.types.AttestationData, attestation.data),
      getDomain(
        this.config,
        {fork} as BeaconState,
        DomainType.BEACON_ATTESTER,
        attestation.data.target.epoch,
      )
    ).toBytesCompressed();
    await this.storeAttestation(attestation);
    this.logger.info(
      `Signed new attestation for block ${attestation.data.target.root.toString("hex")} ` +
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

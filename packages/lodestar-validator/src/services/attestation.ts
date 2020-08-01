/**
 * @module validator/attestation
 */
import {
  AggregateAndProof,
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconState,
  BLSPubkey,
  BLSSignature,
  CommitteeIndex,
  Epoch,
  Fork,
  Root,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import EventSource from "eventsource";
import {IApiClient} from "../api";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {IValidatorDB} from "..";
import {toHexString} from "@chainsafe/ssz";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  DomainType,
  getDomain,
  isSlashableAttestationData,
} from "@chainsafe/lodestar-beacon-state-transition";

import {IAttesterDuty} from "../types";
import {isValidatorAggregator} from "../util/aggregator";

export class AttestationService {

  private readonly config: IBeaconConfig;
  private readonly provider: IApiClient;
  //order is important
  private readonly privateKeys: PrivateKey[] = [];
  //order is important
  private readonly publicKeys: BLSPubkey[] = [];
  private readonly db: IValidatorDB;
  private readonly logger: ILogger;

  private nextAttesterDuties: Map<Slot, IAttesterDuty[]> = new Map();

  public constructor(
    config: IBeaconConfig,
    keypairs: Keypair[],
    rpcClient: IApiClient,
    db: IValidatorDB,
    logger: ILogger
  ) {
    this.config = config;
    this.provider = rpcClient;
    keypairs.forEach((keypair) => {
      this.privateKeys.push(keypair.privateKey);
      this.publicKeys.push(keypair.publicKey.toBytesCompressed());
    });
    this.db = db;
    this.logger = logger;
  }

  public start = async (): Promise<void> => {
    const slot = this.provider.getCurrentSlot();
    //get current epoch duties
    await this.onNewEpoch(computeEpochAtSlot(this.config, slot) - 1);

    if(computeStartSlotAtEpoch(this.config, computeEpochAtSlot(this.config, slot)) !== slot) {
      //trigger next epoch duties
      await this.onNewEpoch(computeEpochAtSlot(this.config, slot));
    }
  };

  public onNewEpoch = async (epoch: Epoch): Promise<void> => {
    let attesterDuties: AttesterDuty[] | undefined;
    try {
      attesterDuties = await this.provider.validator.getAttesterDuties(epoch + 1, this.publicKeys);
    } catch (e) {
      this.logger.error(`Failed to obtain attester duty for epoch ${epoch + 1}`, e);
      return;
    }
    const {fork, genesisValidatorsRoot} = (await this.provider.beacon.getFork());
    for(const duty of attesterDuties) {
      const attesterIndex = this.publicKeys.findIndex((pubkey) => {
        return this.config.types.BLSPubkey.equals(pubkey, duty.validatorPubkey);
      });
      const slotSignature = this.getSlotSignature(attesterIndex, duty.attestationSlot, fork, genesisValidatorsRoot);
      const isAggregator = isValidatorAggregator(slotSignature, duty.aggregatorModulo);
      this.logger.debug("new attester duty", {
        slot: duty.attestationSlot,
        modulo: duty.aggregatorModulo,
        validator: toHexString(duty.validatorPubkey),
        committee: duty.committeeIndex,
        isAggregator: String(isAggregator)
      });
      const nextDuty = {
        ...duty,
        attesterIndex,
        isAggregator
      };
      if(this.nextAttesterDuties.has(duty.attestationSlot)) {
        this.nextAttesterDuties.get(duty.attestationSlot).push(nextDuty);
      } else {
        this.nextAttesterDuties.set(duty.attestationSlot, [nextDuty]);
      }
      if (isAggregator) {
        try {
          await this.provider.validator.subscribeCommitteeSubnet(
            duty.attestationSlot,
            slotSignature,
            duty.committeeIndex,
            this.publicKeys[attesterIndex]
          );
        } catch (e) {
          this.logger.error("Failed to subscribe to committee subnet", e);
        }
      }
    }
  };

  public onNewSlot = async (slot: Slot): Promise<void> => {
    if(computeStartSlotAtEpoch(this.config, computeEpochAtSlot(this.config, slot)) === slot) {
      await this.onNewEpoch(computeEpochAtSlot(this.config, slot));
    }
    const duties = this.nextAttesterDuties.get(slot);
    if(duties && duties.length > 0) {
      this.nextAttesterDuties.delete(slot);
      await Promise.all(
        duties.map((duty) => this.handleDuty(duty))
      );
    }
  };

  private async handleDuty(duty: IAttesterDuty): Promise<void> {
    this.logger.info(
      "Handling attestation duty",
      {
        slot: duty.attestationSlot,
        committee: duty.committeeIndex,
        validator: toHexString(duty.validatorPubkey)
      }
    );
    await this.waitForAttestationBlock(duty.attestationSlot);
    let attestation: Attestation|undefined;
    let fork: Fork, genesisValidatorsRoot: Root;
    try {
      ({fork, genesisValidatorsRoot} = (await this.provider.beacon.getFork()));
      attestation = await this.createAttestation(
        duty.attesterIndex,
        duty.attestationSlot,
        duty.committeeIndex,
        fork,
        genesisValidatorsRoot
      );
    } catch (e) {
      this.logger.error(
        "Failed to produce attestation",
        {slot: duty.attestationSlot, committee: duty.committeeIndex, error: e.message}
      );
    }
    if(!attestation) {
      return;
    }

    if (duty.isAggregator) {
      setTimeout(() => {
        this.aggregateAttestations(duty.attesterIndex, duty, attestation, fork, genesisValidatorsRoot);
      }, this.config.params.SECONDS_PER_SLOT / 3 * 1000);
    }
    try {
      await this.provider.validator.publishAttestation(attestation);
      this.logger.info(
        `Published new attestation for block ${toHexString(attestation.data.target.root)} ` +
          `and committee ${duty.committeeIndex} at slot ${duty.attestationSlot}`,
        {validator: toHexString(duty.validatorPubkey)}
      );
    } catch (e) {
      this.logger.error("Failed to publish attestation", e);
    }
  }

  private async waitForAttestationBlock(slot: Slot): Promise<void> {
    this.logger.debug("Waiting for slot block", {slot});
    const eventSource = new EventSource(
      `${this.provider.url}/lodestar/blocks/stream`,
      {https: {rejectUnauthorized: false}}
    );
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.debug("Timed out slot block waiting");
        resolve();
      }, (this.config.params.SECONDS_PER_SLOT / 3) * 1000);
      eventSource.onmessage = (evt: MessageEvent) => {
        try {
          this.logger.debug("received block!");
          const signedBlock: SignedBeaconBlock =
              this.config.types.SignedBeaconBlock.fromJson(
                JSON.parse(evt.data), {case: "snake"}
              );
          if(signedBlock.message.slot === slot) {
            clearTimeout(timeout);
            this.logger.debug("Received slot block", {slot});
            resolve();
          }
        } catch (err) {
          this.logger.error(`Failed to parse block from SSE. Error: ${err.message}`);
        }
      };

    });
    eventSource.close();
  }

  private aggregateAttestations = async (
    attesterIndex: number,
    duty: IAttesterDuty,
    attestation: Attestation,
    fork: Fork,
    genesisValidatorsRoot: Root
  ): Promise<void> => {
    this.logger.info(
      `Aggregating attestations for committee ${duty.committeeIndex} at slot ${duty.attestationSlot}`
    );
    let aggregateAndProof: AggregateAndProof;
    try {
      aggregateAndProof = await this.provider.validator.produceAggregateAndProof(
        attestation.data,
        duty.validatorPubkey
      );
    } catch (e) {
      this.logger.error("Failed to produce aggregate and proof", e);
      return;
    }
    aggregateAndProof.selectionProof = this.getSlotSignature(
      attesterIndex,
      duty.attestationSlot,
      fork,
      genesisValidatorsRoot
    );
    const signedAggregateAndProof: SignedAggregateAndProof = {
      message: aggregateAndProof,
      signature: this.getAggregateAndProofSignature(attesterIndex, fork, genesisValidatorsRoot, aggregateAndProof),
    };
    try {
      await this.provider.validator.publishAggregateAndProof(signedAggregateAndProof);
      this.logger.info(
        `Published signed aggregate and proof for committee ${duty.committeeIndex} at slot ${duty.attestationSlot}`
      );
    } catch (e) {
      this.logger.error(
        `Failed to publish aggregate and proof for committee ${duty.committeeIndex} at slot ${duty.attestationSlot}`,
        e
      );
    }

  };

  private getAggregateAndProofSignature(
    aggregatorIndex: number,
    fork: Fork,
    genesisValidatorsRoot: Root,
    aggregateAndProof: AggregateAndProof): BLSSignature {
    const aggregate = aggregateAndProof.aggregate;
    const domain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.AGGREGATE_AND_PROOF,
      computeEpochAtSlot(this.config, aggregate.data.slot));
    const signingRoot = computeSigningRoot(this.config, this.config.types.AggregateAndProof, aggregateAndProof, domain);
    return this.privateKeys[aggregatorIndex].signMessage(signingRoot).toBytesCompressed();
  }

  private getSlotSignature(attesterIndex: number, slot: Slot, fork: Fork, genesisValidatorsRoot: Root): BLSSignature {
    const domain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.SELECTION_PROOF,
      computeEpochAtSlot(this.config, slot)
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.Slot, slot, domain);
    return this.privateKeys[attesterIndex].signMessage(signingRoot).toBytesCompressed();
  }

  private async createAttestation(
    attesterIndex: number,
    slot: Slot,
    committeeIndex: CommitteeIndex,
    fork: Fork,
    genesisValidatorsRoot: Root): Promise<Attestation> {
    let attestation;
    try {
      attestation = await this.provider.validator.produceAttestation(
        this.publicKeys[attesterIndex],
        committeeIndex,
        slot
      );
    } catch (e) {
      this.logger.error(
        `Failed to obtain attestation from beacon node at slot ${slot} and committee ${committeeIndex}`,
        e
      );
      return null;
    }
    if (await this.isConflictingAttestation(attesterIndex, attestation.data)) {
      this.logger.warn(
        "Avoided signing conflicting attestation! "
                + `Source epoch: ${attestation.data.source.epoch}, `
                + `Target epoch: ${attestation.data.target.epoch}`
      );
      return null;
    }
    const domain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.BEACON_ATTESTER,
      attestation.data.target.epoch,
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.AttestationData, attestation.data, domain);
    attestation.signature = this.privateKeys[attesterIndex].signMessage(
      signingRoot
    ).toBytesCompressed();
    await this.storeAttestation(attesterIndex, attestation);
    this.logger.info(
      `Signed new attestation for block ${toHexString(attestation.data.target.root)} ` +
            `and committee ${committeeIndex} at slot ${slot}`
    );
    return attestation;
  }

  private async isConflictingAttestation(attesterIndex: number, other: AttestationData): Promise<boolean> {
    const potentialAttestationConflicts = await this.db.getAttestations(
      this.publicKeys[attesterIndex],
      {gt: other.target.epoch - 1}
    );
    return potentialAttestationConflicts.some((attestation => {
      return isSlashableAttestationData(this.config, attestation.data, other);
    }));
  }

  private async storeAttestation(attesterIndex: number, attestation: Attestation): Promise<void> {
    await this.db.setAttestation(this.publicKeys[attesterIndex], attestation);

    //cleanup
    const unusedAttestations =
            await this.db.getAttestations(
              this.publicKeys[attesterIndex],
              {gt: 0, lt: attestation.data.target.epoch}
            );
    await this.db.deleteAttestations(this.publicKeys[attesterIndex], unusedAttestations);
  }
}

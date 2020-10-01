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
  Slot,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {AbortController, AbortSignal} from "abort-controller";
import {IApiClient} from "../api";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {IValidatorDB} from "..";
import {toHexString} from "@chainsafe/ssz";
import {ILogger} from "@chainsafe/lodestar-utils";
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
import {abortableTimeout} from "../util/misc";
import abortableSource from "abortable-iterator";
import {BeaconEventType} from "../api/impl/rest/events/types";
import {anySignal} from "any-signal";

export class AttestationService {
  private readonly config: IBeaconConfig;
  private readonly provider: IApiClient;
  // order is important
  private readonly privateKeys: PrivateKey[] = [];
  // order is important
  private readonly publicKeys: BLSPubkey[] = [];
  private readonly db: IValidatorDB;
  private readonly logger: ILogger;

  private nextAttesterDuties: Map<Slot, IAttesterDuty[]> = new Map();
  private controller: AbortController | undefined;

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
    this.controller = new AbortController();
    const slot = this.provider.getCurrentSlot();
    // get current epoch duties
    await this.onNewEpoch(computeEpochAtSlot(this.config, slot) - 1);

    if (computeStartSlotAtEpoch(this.config, computeEpochAtSlot(this.config, slot)) !== slot) {
      // trigger next epoch duties
      await this.onNewEpoch(computeEpochAtSlot(this.config, slot));
    }
  };

  public stop = async (): Promise<void> => {
    if (this.controller) {
      this.controller.abort();
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
    const fork = await this.provider.beacon.state.getFork("head");
    if (!fork) return;
    for (const duty of attesterDuties) {
      const attesterIndex = this.publicKeys.findIndex((pubkey) => {
        return this.config.types.BLSPubkey.equals(pubkey, duty.validatorPubkey);
      });
      const slotSignature = this.getSlotSignature(
        attesterIndex,
        duty.attestationSlot,
        fork,
        this.provider.genesisValidatorsRoot
      );
      const isAggregator = isValidatorAggregator(slotSignature, duty.aggregatorModulo);
      this.logger.debug("new attester duty", {
        slot: duty.attestationSlot,
        modulo: duty.aggregatorModulo,
        validator: toHexString(duty.validatorPubkey),
        committee: duty.committeeIndex,
        isAggregator: String(isAggregator),
      });
      const nextDuty = {
        ...duty,
        attesterIndex,
        isAggregator,
      };
      const attesterDuties = this.nextAttesterDuties.get(duty.attestationSlot);
      if (attesterDuties) {
        attesterDuties.push(nextDuty);
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
    if (computeStartSlotAtEpoch(this.config, computeEpochAtSlot(this.config, slot)) === slot) {
      await this.onNewEpoch(computeEpochAtSlot(this.config, slot));
    }
    const duties = this.nextAttesterDuties.get(slot);
    if (duties && duties.length > 0) {
      this.nextAttesterDuties.delete(slot);
      await Promise.all(duties.map((duty) => this.handleDuty(duty)));
    }
  };

  private async handleDuty(duty: IAttesterDuty): Promise<void> {
    this.logger.info("Handling attestation duty", {
      slot: duty.attestationSlot,
      committee: duty.committeeIndex,
      validator: toHexString(duty.validatorPubkey),
    });
    const abortSignal = this.controller?.signal;
    await this.waitForAttestationBlock(duty.attestationSlot, abortSignal);
    let attestation: Attestation | undefined;
    let fork: Fork, genesisValidatorsRoot: Root;
    try {
      const fork = await this.provider.beacon.state.getFork("head");
      if (!fork) return;
      attestation = await this.createAttestation(
        duty.attesterIndex,
        duty.attestationSlot,
        duty.committeeIndex,
        fork,
        this.provider.genesisValidatorsRoot
      );
    } catch (e) {
      this.logger.error("Failed to produce attestation", {
        slot: duty.attestationSlot,
        committee: duty.committeeIndex,
        error: e.message,
      });
    }
    if (!attestation) {
      return;
    }

    if (duty.isAggregator) {
      const timeout = setTimeout(async (signal = abortSignal) => {
        this.logger.debug("AttestationService: Start waitForAggregate");
        abortableTimeout(signal, () => {
          clearTimeout(timeout);
          this.logger.debug("AttestationService: Abort waitForAggregate");
        });

        try {
          if (attestation) {
            await this.aggregateAttestations(duty.attesterIndex, duty, attestation, fork, genesisValidatorsRoot);
          }
        } catch (e) {
          this.logger.error("Failed to aggregate attestations", e);
        }
      }, (this.config.params.SECONDS_PER_SLOT / 3) * 1000);
    }
    try {
      await this.provider.validator.publishAttestation(attestation);
      this.logger.info("Published new attestation", {
        slot: attestation.data.slot,
        committee: attestation.data.index,
        attestation: toHexString(this.config.types.Attestation.hashTreeRoot(attestation)),
        block: toHexString(attestation.data.target.root),
        validator: toHexString(duty.validatorPubkey),
      });
    } catch (e) {
      this.logger.error("Failed to publish attestation", e);
    }
  }

  private async waitForAttestationBlock(slot: Slot, signal?: AbortSignal): Promise<void> {
    this.logger.debug("Waiting for slot block", {slot});
    const eventSource = this.provider.events.getEventStream([BeaconEventType.BLOCK]);
    const timeoutController = new AbortController();
    const signals = [timeoutController.signal];
    if (signal) {
      signals.push(signal);
    }
    const source = abortableSource(eventSource, anySignal(signals), {returnOnAbort: true});
    const timeout = setTimeout(() => {
      timeoutController.abort();
    }, (this.config.params.SECONDS_PER_SLOT / 3) * 1000);
    for await (const event of source) {
      if (event.type === BeaconEventType.BLOCK && event.message.slot === slot) {
        clearTimeout(timeout);
        eventSource.stop();
        return;
      }
    }
    this.logger.debug("Timeout out waiting for slot block", {slot});
    clearTimeout(timeout);
    eventSource.stop();
  }

  private aggregateAttestations = async (
    attesterIndex: number,
    duty: IAttesterDuty,
    attestation: Attestation,
    fork: Fork,
    genesisValidatorsRoot: Root
  ): Promise<void> => {
    this.logger.info(`Aggregating attestations for committee ${duty.committeeIndex} at slot ${duty.attestationSlot}`);
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
    aggregateAndProof: AggregateAndProof
  ): BLSSignature {
    const aggregate = aggregateAndProof.aggregate;
    const domain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.AGGREGATE_AND_PROOF,
      computeEpochAtSlot(this.config, aggregate.data.slot)
    );
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
    genesisValidatorsRoot: Root
  ): Promise<Attestation> {
    let attestation;
    try {
      attestation = await this.provider.validator.produceAttestation(
        this.publicKeys[attesterIndex],
        committeeIndex,
        slot
      );
    } catch (e) {
      e.message = `Failed to obtain attestation at slot ${slot} and committee ${committeeIndex}: ${e.message}`;
      throw e;
    }
    if (await this.isConflictingAttestation(attesterIndex, attestation.data)) {
      throw Error(
        "Avoided signing conflicting attestation! " +
          `Source epoch: ${attestation.data.source.epoch}, ` +
          `Target epoch: ${attestation.data.target.epoch}`
      );
    }
    const domain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.BEACON_ATTESTER,
      attestation.data.target.epoch
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.AttestationData, attestation.data, domain);
    attestation.signature = this.privateKeys[attesterIndex].signMessage(signingRoot).toBytesCompressed();
    await this.storeAttestation(attesterIndex, attestation);
    this.logger.info(
      `Signed new attestation for block ${toHexString(attestation.data.target.root)} ` +
        `and committee ${committeeIndex} at slot ${slot}`
    );
    return attestation;
  }

  private async isConflictingAttestation(attesterIndex: number, other: AttestationData): Promise<boolean> {
    const potentialAttestationConflicts = await this.db.getAttestations(this.publicKeys[attesterIndex], {
      gte: other.target.epoch,
    });
    return potentialAttestationConflicts.some((attestation) => {
      const result = isSlashableAttestationData(this.config, attestation.data, other);
      if (result) {
        this.logger.info("conflict", {
          validator: toHexString(this.publicKeys[attesterIndex]),
          attesterIndex,
          targetEpoch: other.target.epoch,
          conflictx: JSON.stringify(potentialAttestationConflicts),
        });
      }
      return result;
    });
  }

  private async storeAttestation(attesterIndex: number, attestation: Attestation): Promise<void> {
    await this.db.setAttestation(this.publicKeys[attesterIndex], attestation);

    // cleanup
    const unusedAttestations = await this.db.getAttestations(this.publicKeys[attesterIndex], {
      gte: 0,
      lt: attestation.data.target.epoch,
    });
    await this.db.deleteAttestations(this.publicKeys[attesterIndex], unusedAttestations);
  }
}

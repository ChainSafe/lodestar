/**
 * @module validator/attestation
 */
import {SecretKey} from "@chainsafe/bls";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  DomainType,
  getDomain,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  AggregateAndProof,
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconState,
  BLSPubkey,
  BLSSignature,
  Epoch,
  Fork,
  Root,
  SignedAggregateAndProof,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString, List, fromHexString} from "@chainsafe/ssz";
import {AbortController, AbortSignal} from "abort-controller";
import {IApiClient} from "../api";
import {ClockEventType} from "../api/interface/clock";
import {BeaconEventType} from "../api/interface/events";
import {ISlashingProtection} from "../slashingProtection";
import {IAttesterDuty, ValidatorAndSecret} from "../types";
import {isValidatorAggregator} from "../util/aggregator";
import {abortableTimeout} from "../util/misc";
import {getAggregationBits, getAggregatorModulo} from "./utils";

/**
 * Service that sets up and handles validator attester duties.
 */
export class AttestationService {
  private readonly config: IBeaconConfig;
  private readonly provider: IApiClient;
  private readonly validators: Map<string, ValidatorAndSecret> = new Map();
  private readonly slashingProtection: ISlashingProtection;
  private readonly logger: ILogger;

  private nextAttesterDuties: Map<Slot, Map<BLSPubkey, IAttesterDuty>> = new Map();
  private controller: AbortController | undefined;

  public constructor(
    config: IBeaconConfig,
    secretKeys: SecretKey[],
    rpcClient: IApiClient,
    slashingProtection: ISlashingProtection,
    logger: ILogger
  ) {
    this.config = config;
    this.provider = rpcClient;
    for (const secretKey of secretKeys) {
      this.validators.set(toHexString(secretKey.toPublicKey().toBytes()), {validator: null, secretKey});
    }
    this.slashingProtection = slashingProtection;
    this.logger = logger;
  }

  /**
   * Starts the AttestationService by updating the validator attester duties and turning on the relevant listeners for clock events.
   */
  public start = async (): Promise<void> => {
    this.controller = new AbortController();
    const currentEpoch = this.provider.clock.currentEpoch;
    await this.updateValidators();
    // get current epoch duties
    await this.updateDuties(currentEpoch);
    await this.updateDuties(currentEpoch + 1);
    this.provider.on(ClockEventType.CLOCK_EPOCH, this.onClockEpoch);
    this.provider.on(ClockEventType.CLOCK_SLOT, this.onClockSlot);
    this.provider.on(BeaconEventType.HEAD, this.onHead);
  };

  /**
   * Stops the AttestationService by turning off the relevant listeners for clock events.
   */
  public stop = async (): Promise<void> => {
    if (this.controller) {
      this.controller.abort();
    }
    this.provider.off(ClockEventType.CLOCK_EPOCH, this.onClockEpoch);
    this.provider.off(ClockEventType.CLOCK_SLOT, this.onClockSlot);
    this.provider.off(BeaconEventType.HEAD, this.onHead);
  };

  /**
   * Update validator attester duties on each clock epoch.
   */
  public onClockEpoch = async ({epoch}: {epoch: Epoch}): Promise<void> => {
    await this.updateValidators();
    await this.updateDuties(epoch + 1);
  };

  /**
   * Perform attestation duties if the validator is an attester for a given clock slot.
   */
  public onClockSlot = async ({slot}: {slot: Slot}): Promise<void> => {
    const duties = this.nextAttesterDuties.get(slot);
    if (duties && duties.size > 0) {
      this.nextAttesterDuties.delete(slot);
      await Promise.all(Array.from(duties.values()).map((duty) => this.handleDuty(duty)));
    }
  };

  /**
   * Update list of attester duties on head upate.
   */
  public onHead = async ({slot, epochTransition}: {slot: Slot; epochTransition: boolean}): Promise<void> => {
    if (epochTransition) {
      // refetch next epoch's duties
      await this.updateDuties(computeEpochAtSlot(this.config, slot) + 1);
    }
  };

  /**
   * Fetch validator attester duties from the validator api and update local list of attester duties accordingly.
   */
  public async updateDuties(epoch: Epoch): Promise<void> {
    let attesterDuties: AttesterDuty[] | undefined;
    try {
      const indices: ValidatorIndex[] = [];
      this.validators.forEach((v) => {
        if (v.validator?.index != null) indices.push(v.validator?.index);
      });
      attesterDuties = await this.provider.validator.getAttesterDuties(epoch, indices);
    } catch (e) {
      this.logger.error("Failed to obtain attester duty", {epoch, error: e.message});
      return;
    }
    const fork = await this.provider.beacon.state.getFork("head");
    if (!fork) {
      return;
    }
    for (const duty of attesterDuties) {
      const validator = this.validators.get(toHexString(duty.pubkey));
      if (!validator) continue;
      const slotSignature = this.getSlotSignature(validator, duty.slot, fork, this.provider.genesisValidatorsRoot);
      const modulo = getAggregatorModulo(this.config, duty);
      const isAggregator = isValidatorAggregator(slotSignature, modulo);
      this.logger.debug("new attester duty", {
        slot: duty.slot,
        modulo: modulo,
        validator: toHexString(duty.pubkey),
        committee: duty.committeeIndex,
        isAggregator: String(isAggregator),
      });
      const nextDuty = {
        ...duty,
        isAggregator,
      };
      let attesterDuties = this.nextAttesterDuties.get(duty.slot);
      if (!attesterDuties) {
        attesterDuties = new Map();
        this.nextAttesterDuties.set(duty.slot, attesterDuties);
      }
      attesterDuties.set(duty.pubkey, nextDuty);
      try {
        await this.provider.validator.prepareBeaconCommitteeSubnet(
          nextDuty.validatorIndex,
          nextDuty.committeeIndex,
          nextDuty.committeesAtSlot,
          nextDuty.slot,
          isAggregator
        );
      } catch (e) {
        this.logger.error("Failed to subscribe to committee subnet", e);
      }
    }
  }

  /**
   * Perform attestation/aggregation duties.
   * IFF a validator is an attester, create and submit an attestation.
   * IFF a validator is an aggregator, aggregate the attestations and submit the aggregated data.
   */
  private async handleDuty(duty: IAttesterDuty): Promise<void> {
    const validator = this.validators.get(toHexString(duty.pubkey));
    // TODO: is this how we should handle a non-matching validator?
    if (!validator) return;

    this.logger.info("Handling attestation duty", {
      slot: duty.slot,
      committee: duty.committeeIndex,
      validator: toHexString(duty.pubkey),
    });
    const abortSignal = this.controller!.signal;
    await this.waitForAttestationBlock(duty.slot, abortSignal);
    let attestation: Attestation | undefined;
    let fork: Fork | null;
    try {
      fork = await this.provider.beacon.state.getFork("head");
      if (!fork) {
        return;
      }
      attestation = await this.createAttestation(duty, fork, this.provider.genesisValidatorsRoot, validator);
    } catch (e) {
      this.logger.error("Failed to produce attestation", {
        slot: duty.slot,
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
            if (!fork) {
              throw new Error("Missing fork info");
            }
            await this.aggregateAttestations(duty, attestation, fork, this.provider.genesisValidatorsRoot, validator);
          }
        } catch (e) {
          this.logger.error("Failed to aggregate attestations", e);
        }
      }, (this.config.params.SECONDS_PER_SLOT / 3) * 1000);
    }
    try {
      await this.provider.beacon.pool.submitAttestation(attestation);
      this.logger.info("Published new attestation", {
        slot: attestation.data.slot,
        committee: attestation.data.index,
        attestation: toHexString(this.config.types.Attestation.hashTreeRoot(attestation)),
        block: toHexString(attestation.data.target.root),
        validator: toHexString(duty.pubkey),
      });
    } catch (e) {
      this.logger.error("Failed to publish attestation", e);
    }
  }

  /**
   * Makes sure that the block we are trying to attest to is available.
   */
  private async waitForAttestationBlock(blockSlot: Slot, signal: AbortSignal): Promise<void> {
    this.logger.debug("Waiting for block at slot", {blockSlot});
    return new Promise((resolve, reject) => {
      const onSuccess = (): void => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        this.provider.removeListener(BeaconEventType.BLOCK, onBlock);
        resolve();
      };
      const onAbort = (): void => {
        clearTimeout(timeout);
        this.provider.removeListener(BeaconEventType.BLOCK, onBlock);
        reject();
      };
      const onTimeout = (): void => {
        this.logger.debug("Timeout out waiting for block at slot", {blockSlot});
        onSuccess();
      };
      const onBlock = ({slot}: {slot: Slot}): void => {
        if (blockSlot === slot) {
          this.logger.debug("Found block at slot", {blockSlot});
          onSuccess();
        }
      };
      signal.addEventListener("abort", onAbort, {once: true});
      const timeout = setTimeout(onTimeout, (this.config.params.SECONDS_PER_SLOT / 3) * 1000);
      this.provider.on(BeaconEventType.BLOCK, onBlock);
    });
  }

  /**
   * Aggregate attestations publish the aggregate.
   */
  private aggregateAttestations = async (
    duty: IAttesterDuty,
    attestation: Attestation,
    fork: Fork,
    genesisValidatorsRoot: Root,
    validator: ValidatorAndSecret
  ): Promise<void> => {
    this.logger.info("Aggregating attestations", {committeeIndex: duty.committeeIndex, slot: duty.slot});
    let aggregate: Attestation;
    try {
      aggregate = await this.provider.validator.getAggregatedAttestation(
        this.config.types.AttestationData.hashTreeRoot(attestation.data),
        duty.slot
      );
    } catch (e) {
      this.logger.error("Failed to produce aggregate and proof", e);
      return;
    }
    const aggregateAndProof: AggregateAndProof = {
      aggregate,
      aggregatorIndex: duty.validatorIndex,
      selectionProof: Buffer.alloc(96, 0),
    };
    aggregateAndProof.selectionProof = this.getSlotSignature(validator, duty.slot, fork, genesisValidatorsRoot);
    const signedAggregateAndProof: SignedAggregateAndProof = {
      message: aggregateAndProof,
      signature: this.getAggregateAndProofSignature(validator, fork, genesisValidatorsRoot, aggregateAndProof),
    };
    try {
      await this.provider.validator.publishAggregateAndProofs([signedAggregateAndProof]);
      this.logger.info("Published signed aggregate and proof", {committeeIndex: duty.committeeIndex, slot: duty.slot});
    } catch (e) {
      this.logger.error(
        "Failed to publish aggregate and proof",
        {committeeIndex: duty.committeeIndex, slot: duty.slot},
        e
      );
    }
  };

  private getAggregateAndProofSignature(
    validator: ValidatorAndSecret,
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
    return validator.secretKey.sign(signingRoot).toBytes();
  }

  private getSlotSignature(
    validator: ValidatorAndSecret,
    slot: Slot,
    fork: Fork,
    genesisValidatorsRoot: Root
  ): BLSSignature {
    const domain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.SELECTION_PROOF,
      computeEpochAtSlot(this.config, slot)
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.Slot, slot, domain);
    return validator.secretKey.sign(signingRoot).toBytes();
  }

  private async createAttestation(
    duty: IAttesterDuty,
    fork: Fork,
    genesisValidatorsRoot: Root,
    validator: ValidatorAndSecret
  ): Promise<Attestation> {
    const {committeeIndex, slot} = duty;
    let attestationData: AttestationData;
    try {
      attestationData = await this.provider.validator.produceAttestationData(committeeIndex, slot);
    } catch (e) {
      e.message = `Failed to obtain attestation data at slot ${slot} and committee ${committeeIndex}: ${e.message}`;
      throw e;
    }

    const domain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.BEACON_ATTESTER,
      attestationData.target.epoch
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.AttestationData, attestationData, domain);

    await this.slashingProtection.checkAndInsertAttestation(duty.pubkey, {
      sourceEpoch: attestationData.target.epoch,
      targetEpoch: attestationData.target.epoch,
      signingRoot,
    });

    const attestation: Attestation = {
      aggregationBits: getAggregationBits(duty.committeeLength, duty.validatorCommitteeIndex) as List<boolean>,
      data: attestationData,
      signature: validator.secretKey.sign(signingRoot).toBytes(),
    };
    this.logger.info("Signed new attestation", {
      block: toHexString(attestation.data.target.root),
      committeeIndex,
      slot,
    });
    return attestation;
  }

  /**
   * Update the local list of validators based on the current head state.
   */
  private async updateValidators(): Promise<void> {
    this.validators.forEach(async (v, pk) => {
      if (!v.validator) {
        try {
          v.validator = await this.provider.beacon.state.getStateValidator("head", fromHexString(pk));
        } catch (e) {
          this.logger.error("Failed to get validator details", e);
          v.validator = null;
        }
      }
    });
  }
}

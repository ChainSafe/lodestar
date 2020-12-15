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
  ValidatorResponse,
} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString, List} from "@chainsafe/ssz";
import {AbortController, AbortSignal} from "abort-controller";
import {IApiClient} from "../api";
import {ClockEventType} from "../api/interface/clock";
import {BeaconEventType} from "../api/interface/events";
import {ISlashingProtection} from "../slashingProtection";
import {IAttesterDuty} from "../types";
import {isValidatorAggregator} from "../util/aggregator";
import {abortableTimeout} from "../util/misc";
import {getAggregationBits, getAggregatorModulo, getPubKeyIndex} from "./utils";

export class AttestationService {
  private readonly config: IBeaconConfig;
  private readonly provider: IApiClient;
  private readonly validatorClients: {
    validator: ValidatorResponse | null;
    publicKey: BLSPubkey;
    secretKey: SecretKey;
  }[] = [];
  private readonly slashingProtection: ISlashingProtection;
  private readonly logger: ILogger;

  private nextAttesterDuties: Map<Slot, Map<number, IAttesterDuty>> = new Map();
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
      this.validatorClients.push({validator: null, secretKey: secretKey, publicKey: secretKey.toPublicKey().toBytes()});
    }
    this.slashingProtection = slashingProtection;
    this.logger = logger;
  }

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

  public stop = async (): Promise<void> => {
    if (this.controller) {
      this.controller.abort();
    }
    this.provider.off(ClockEventType.CLOCK_EPOCH, this.onClockEpoch);
    this.provider.off(ClockEventType.CLOCK_SLOT, this.onClockSlot);
    this.provider.off(BeaconEventType.HEAD, this.onHead);
  };

  public onClockEpoch = async ({epoch}: {epoch: Epoch}): Promise<void> => {
    await this.updateValidators();
    await this.updateDuties(epoch + 1);
  };

  public onClockSlot = async ({slot}: {slot: Slot}): Promise<void> => {
    const duties = this.nextAttesterDuties.get(slot);
    if (duties && duties.size > 0) {
      this.nextAttesterDuties.delete(slot);
      await Promise.all(Array.from(duties.values()).map((duty) => this.handleDuty(duty)));
    }
  };

  public onHead = async ({slot, epochTransition}: {slot: Slot; epochTransition: boolean}): Promise<void> => {
    if (epochTransition) {
      // refetch next epoch's duties
      await this.updateDuties(computeEpochAtSlot(this.config, slot) + 1);
    }
  };

  public async updateDuties(epoch: Epoch): Promise<void> {
    let attesterDuties: AttesterDuty[] | undefined;
    try {
      attesterDuties = await this.provider.validator.getAttesterDuties(
        epoch,
        this.validatorClients.map((v) => v.validator?.index ?? null).filter((i) => i !== null) as ValidatorIndex[]
      );
    } catch (e) {
      this.logger.error("Failed to obtain attester duty", {epoch, error: e.message});
      return;
    }
    const fork = await this.provider.beacon.state.getFork("head");
    if (!fork) {
      return;
    }
    for (const duty of attesterDuties) {
      const attesterIndex = getPubKeyIndex(this.config, duty.pubkey, this.validatorClients);
      const slotSignature = this.getSlotSignature(attesterIndex, duty.slot, fork, this.provider.genesisValidatorsRoot);
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
        attesterIndex,
        isAggregator,
      };
      let attesterDuties = this.nextAttesterDuties.get(duty.slot);
      if (!attesterDuties) {
        attesterDuties = new Map();
        this.nextAttesterDuties.set(duty.slot, attesterDuties);
      }
      attesterDuties.set(attesterIndex, nextDuty);
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

  private async handleDuty(duty: IAttesterDuty): Promise<void> {
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
      attestation = await this.createAttestation(duty, fork, this.provider.genesisValidatorsRoot);
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
            await this.aggregateAttestations(duty, attestation, fork, this.provider.genesisValidatorsRoot);
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

  private aggregateAttestations = async (
    duty: IAttesterDuty,
    attestation: Attestation,
    fork: Fork,
    genesisValidatorsRoot: Root
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
    aggregateAndProof.selectionProof = this.getSlotSignature(
      duty.attesterIndex,
      duty.slot,
      fork,
      genesisValidatorsRoot
    );
    const signedAggregateAndProof: SignedAggregateAndProof = {
      message: aggregateAndProof,
      signature: this.getAggregateAndProofSignature(duty.attesterIndex, fork, genesisValidatorsRoot, aggregateAndProof),
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
    return this.validatorClients[aggregatorIndex].secretKey.sign(signingRoot).toBytes();
  }

  private getSlotSignature(attesterIndex: number, slot: Slot, fork: Fork, genesisValidatorsRoot: Root): BLSSignature {
    const domain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.SELECTION_PROOF,
      computeEpochAtSlot(this.config, slot)
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.Slot, slot, domain);
    return this.validatorClients[attesterIndex].secretKey.sign(signingRoot).toBytes();
  }

  private async createAttestation(duty: IAttesterDuty, fork: Fork, genesisValidatorsRoot: Root): Promise<Attestation> {
    const {committeeIndex, slot, attesterIndex} = duty;
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

    await this.slashingProtection.checkAndInsertAttestation(this.validatorClients[attesterIndex].publicKey, {
      sourceEpoch: attestationData.target.epoch,
      targetEpoch: attestationData.target.epoch,
      signingRoot,
    });

    const attestation: Attestation = {
      aggregationBits: getAggregationBits(duty.committeeLength, duty.validatorCommitteeIndex) as List<boolean>,
      data: attestationData,
      signature: this.validatorClients[attesterIndex].secretKey.sign(signingRoot).toBytes(),
    };
    this.logger.info("Signed new attestation", {
      block: toHexString(attestation.data.target.root),
      committeeIndex,
      slot,
    });
    return attestation;
  }

  private async updateValidators(): Promise<void> {
    for (const validatorClient of this.validatorClients) {
      // fetch validator details if missing
      if (!validatorClient.validator) {
        try {
          validatorClient.validator = await this.provider.beacon.state.getStateValidator(
            "head",
            validatorClient.publicKey
          );
        } catch (e) {
          this.logger.error("Failed to get validator details", e);
          validatorClient.validator = null;
        }
      }
    }
  }
}

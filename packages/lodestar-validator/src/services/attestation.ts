/**
 * @module validator/attestation
 */
import {
  AggregateAndProof,
  Attestation,
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
  ValidatorResponse,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {AbortController, AbortSignal} from "abort-controller";
import {IApiClient} from "../api";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {ILogger} from "@chainsafe/lodestar-utils";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  DomainType,
  getDomain,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IAttesterDuty} from "../types";
import {isValidatorAggregator} from "../util/aggregator";
import {abortableTimeout} from "../util/misc";
import {BeaconEventType} from "../api/interface/events";
import {ClockEventType} from "../api/interface/clock";
import {ISlashingProtection} from "../slashingProtection";
import {getAggregatorModulo} from "./utils";

export class AttestationService {
  private readonly config: IBeaconConfig;
  private readonly provider: IApiClient;
  // order is important
  private readonly privateKeys: PrivateKey[] = [];
  // order is important
  private readonly publicKeys: BLSPubkey[] = [];
  // order is important
  private readonly validators: (ValidatorResponse | null)[] = [];
  private readonly slashingProtection: ISlashingProtection;
  private readonly logger: ILogger;

  private nextAttesterDuties: Map<Slot, Map<number, IAttesterDuty>> = new Map();
  private controller: AbortController | undefined;

  public constructor(
    config: IBeaconConfig,
    keypairs: Keypair[],
    rpcClient: IApiClient,
    slashingProtection: ISlashingProtection,
    logger: ILogger
  ) {
    this.config = config;
    this.provider = rpcClient;
    keypairs.forEach((keypair) => {
      this.privateKeys.push(keypair.privateKey);
      this.publicKeys.push(keypair.publicKey.toBytesCompressed());
      this.validators.push(null);
    });
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
        this.validators.map((v) => v?.index ?? null).filter((i) => i !== null) as ValidatorIndex[]
      );
    } catch (e) {
      this.logger.error(`Failed to obtain attester duty for epoch ${epoch}`, e.message);
      return;
    }
    const fork = await this.provider.beacon.state.getFork("head");
    if (!fork) {
      return;
    }
    for (const duty of attesterDuties) {
      const attesterIndex = this.publicKeys.findIndex((pubkey) => {
        return this.config.types.BLSPubkey.equals(pubkey, duty.pubkey);
      });
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
      if (isAggregator) {
        try {
          await this.provider.validator.subscribeCommitteeSubnet(
            duty.slot,
            slotSignature,
            duty.committeeIndex,
            this.publicKeys[attesterIndex]
          );
        } catch (e) {
          this.logger.error("Failed to subscribe to committee subnet", e);
        }
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
      attestation = await this.createAttestation(
        duty.attesterIndex,
        duty.slot,
        duty.committeeIndex,
        fork,
        this.provider.genesisValidatorsRoot
      );
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
            await this.aggregateAttestations(
              duty.attesterIndex,
              duty,
              attestation,
              fork,
              this.provider.genesisValidatorsRoot
            );
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
    attesterIndex: number,
    duty: IAttesterDuty,
    attestation: Attestation,
    fork: Fork,
    genesisValidatorsRoot: Root
  ): Promise<void> => {
    this.logger.info(`Aggregating attestations for committee ${duty.committeeIndex} at slot ${duty.slot}`);
    let aggregateAndProof: AggregateAndProof;
    try {
      aggregateAndProof = await this.provider.validator.produceAggregateAndProof(attestation.data, duty.pubkey);
    } catch (e) {
      this.logger.error("Failed to produce aggregate and proof", e);
      return;
    }
    aggregateAndProof.selectionProof = this.getSlotSignature(attesterIndex, duty.slot, fork, genesisValidatorsRoot);
    const signedAggregateAndProof: SignedAggregateAndProof = {
      message: aggregateAndProof,
      signature: this.getAggregateAndProofSignature(attesterIndex, fork, genesisValidatorsRoot, aggregateAndProof),
    };
    try {
      await this.provider.validator.publishAggregateAndProof(signedAggregateAndProof);
      this.logger.info(
        `Published signed aggregate and proof for committee ${duty.committeeIndex} at slot ${duty.slot}`
      );
    } catch (e) {
      this.logger.error(
        `Failed to publish aggregate and proof for committee ${duty.committeeIndex} at slot ${duty.slot}`,
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

    const domain = getDomain(
      this.config,
      {fork, genesisValidatorsRoot} as BeaconState,
      DomainType.BEACON_ATTESTER,
      attestation.data.target.epoch
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.AttestationData, attestation.data, domain);

    await this.slashingProtection.checkAndInsertAttestation(this.publicKeys[attesterIndex], {
      sourceEpoch: attestation.data.target.epoch,
      targetEpoch: attestation.data.target.epoch,
      signingRoot,
    });

    attestation.signature = this.privateKeys[attesterIndex].signMessage(signingRoot).toBytesCompressed();
    this.logger.info(
      `Signed new attestation for block ${toHexString(attestation.data.target.root)} ` +
        `and committee ${committeeIndex} at slot ${slot}`
    );
    return attestation;
  }

  private async updateValidators(): Promise<void> {
    let index = 0;
    for (const pubkey of this.publicKeys) {
      //fetch validator details if missing
      if (!this.validators[index]) {
        try {
          this.validators[index] = await this.provider.beacon.state.getStateValidator("head", pubkey);
        } catch (e) {
          this.logger.error("Failed to get validator details", e);
          this.validators[index] = null;
        }
      }
      index++;
    }
  }
}

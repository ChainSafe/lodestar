import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BLSPubkey, BLSSignature, Epoch, phase0, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IApiClient} from "../api";
import {extendError, getAggregatorModulo, isValidatorAggregator, notAborted} from "../util";
import {IClock} from "../util/clock";
import {ValidatorStore} from "./validatorStore";

/** Only retain `HISTORICAL_DUTIES_EPOCHS` duties prior to the current epoch. */
const HISTORICAL_DUTIES_EPOCHS = 2;

/** Neatly joins the server-generated `AttesterData` with the locally-generated `selectionProof`. */
export type DutyAndProof = {
  duty: phase0.AttesterDuty;
  /** This value is only set to not null if the proof indicates that the validator is an aggregator. */
  selectionProof: BLSSignature | null;
};

// To assist with readability
type PubkeyHex = string;
type AttDutyAtEpoch = {dependentRoot: Root; dutyAndProof: DutyAndProof};

export class AttestationDutiesService {
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly apiClient: IApiClient;
  private readonly validatorStore: ValidatorStore;
  /** Indexed by pubkey in hex 0x prefixed */
  private readonly indices = new Map<PubkeyHex, ValidatorIndex>();
  /** Maps a validator public key to their duties for each epoch */
  private readonly attesters = new Map<PubkeyHex, Map<Epoch, AttDutyAtEpoch>>();

  constructor(
    config: IBeaconConfig,
    logger: ILogger,
    apiClient: IApiClient,
    clock: IClock,
    validatorStore: ValidatorStore
  ) {
    this.config = config;
    this.logger = logger;
    this.apiClient = apiClient;
    this.validatorStore = validatorStore;

    // Running this task every epoch is safe since a re-org of two epochs is very unlikely
    // TODO: If the re-org event is reliable consider re-running then
    clock.runEveryEpoch(this.runAttesterDutiesTasks);
  }

  /** Returns all `ValidatorDuty` for the given `slot` */
  getAttestersAtSlot(slot: Slot): DutyAndProof[] {
    const epoch = computeEpochAtSlot(this.config, slot);
    const duties: DutyAndProof[] = [];

    for (const attMap of this.attesters.values()) {
      const dutyAtEpoch = attMap.get(epoch);
      if (dutyAtEpoch && dutyAtEpoch.dutyAndProof.duty.slot === slot) {
        duties.push(dutyAtEpoch.dutyAndProof);
      }
    }

    return duties;
  }

  private runAttesterDutiesTasks = async (epoch: Epoch): Promise<void> => {
    // Run this poll before the wait, this should hopefully download all the indices
    // before the block/attestation tasks need them.
    await this.pollValidatorIndices().catch((e) => {
      if (notAborted(e)) this.logger.error("Error on pollValidatorIndices", {}, e);
    });
    await this.pollBeaconAttesters(epoch).catch((e) => {
      if (notAborted(e)) this.logger.error("Error on pollBeaconAttesters", {}, e);
    });
  };

  /** Iterate through all the voting pubkeys in the `ValidatorStore` and attempt to learn any unknown
      validator indices. */
  private async pollValidatorIndices(): Promise<void> {
    const pubkeys = this.validatorStore.votingPubkeys();

    const pubkeysToPoll: BLSPubkey[] = [];
    for (const pubkey of pubkeys) {
      if (!this.indices.has(toHexString(pubkey))) {
        pubkeysToPoll.push(pubkey);
      }
    }

    if (pubkeysToPoll.length === 0) {
      return;
    }

    // Query the remote BN to resolve a pubkey to a validator index.
    const validatorsState = await this.apiClient.beacon.state.getStateValidators("head", {indices: pubkeysToPoll});

    for (const validatorState of validatorsState) {
      const pubkeyHex = toHexString(validatorState.validator.pubkey);
      this.logger.debug("Discovered validator", {pubkey: pubkeyHex, index: validatorState.index});
      this.indices.set(pubkeyHex, validatorState.index);
    }
  }

  /**
   * Query the beacon node for attestation duties for any known validators.
   *
   * This function will perform (in the following order):
   *
   * 1. Poll for current-epoch duties and update the local `this.attesters` map.
   * 2. As above, but for the next-epoch.
   * 3. Push out any attestation subnet subscriptions to the BN.
   * 4. Prune old entries from `this.attesters`.
   */
  private async pollBeaconAttesters(currentEpoch: Epoch): Promise<void> {
    const nextEpoch = currentEpoch + 1;

    const localPubkeys = this.validatorStore.votingPubkeys();
    const localIndices: ValidatorIndex[] = [];
    for (const pubkey of localPubkeys) {
      const index = this.indices.get(toHexString(pubkey));
      if (index !== undefined) {
        localIndices.push(index);
      }
    }

    for (const epoch of [currentEpoch, nextEpoch]) {
      // Download the duties and update the duties for the current and next epoch.
      // No need to bother the BN if we don't have any validators.
      if (localIndices.length > 0) {
        await this.pollBeaconAttestersForEpoch(epoch, localIndices).catch((e) => {
          if (notAborted(e)) this.logger.error("Failed to download attester duties", {epoch}, e);
        });
      }
    }

    // This vector is likely to be a little oversized, but it won't reallocate.
    const beaconCommitteeSubscriptions: phase0.BeaconCommitteeSubscription[] = [];

    // For this epoch and the next epoch, produce any beacon committee subscriptions.
    //
    // We are *always* pushing out subscriptions, even if we've subscribed before. This is
    // potentially excessive on the BN in normal cases, but it will help with fast re-subscriptions
    // if the BN goes offline or we swap to a different one.
    for (const epoch of [currentEpoch, nextEpoch]) {
      for (const attMap of this.attesters.values()) {
        const dutyAtEpoch = attMap.get(epoch);
        if (dutyAtEpoch) {
          const {duty, selectionProof} = dutyAtEpoch.dutyAndProof;
          beaconCommitteeSubscriptions.push({
            validatorIndex: duty.validatorIndex,
            committeesAtSlot: duty.committeesAtSlot,
            committeeIndex: duty.committeeIndex,
            slot: duty.slot,
            isAggregator: selectionProof !== null,
          });
        }
      }
    }

    // If there are any subscriptions, push them out to the beacon node.
    if (beaconCommitteeSubscriptions.length > 0) {
      // TODO: Should log or throw?
      await this.apiClient.validator.prepareBeaconCommitteeSubnet(beaconCommitteeSubscriptions).catch((e) => {
        throw extendError(e, "Failed to subscribe to committee subnet");
      });
    }

    // Prune old duties
    for (const attMap of this.attesters.values()) {
      for (const epoch of attMap.keys()) {
        if (epoch + HISTORICAL_DUTIES_EPOCHS < currentEpoch) {
          attMap.delete(epoch);
        }
      }
    }
  }

  /** For the given `localIndices` and `localPubkeys`, download the duties for the given `epoch` and
      store them in `this.attesters`. */
  private async pollBeaconAttestersForEpoch(epoch: Epoch, localIndices: ValidatorIndex[]): Promise<void> {
    // TODO: Implement dependentRoot logic
    const attesterDuties = await this.apiClient.validator.getAttesterDuties(epoch, localIndices).catch((e) => {
      throw extendError(e, "Failed to obtain attester duty");
    });
    const dependentRoot = attesterDuties.dependentRoot;
    const relevantDuties = attesterDuties.data.filter((duty) =>
      this.validatorStore.hasVotingPubkey(toHexString(duty.pubkey))
    );

    this.logger.debug("Downloaded attester duties", {
      epoch,
      dependentRoot: toHexString(dependentRoot),
      count: relevantDuties.length,
    });

    let alreadyWarnedReorg = false;
    for (const duty of relevantDuties) {
      const pubkeyHex = toHexString(duty.pubkey);
      let attMap = this.attesters.get(pubkeyHex);
      if (!attMap) {
        attMap = new Map<Epoch, AttDutyAtEpoch>();
        this.attesters.set(pubkeyHex, attMap);
      }

      // Only update the duties if either is true:
      //
      // - There were no known duties for this epoch.
      // - The dependent root has changed, signalling a re-org.
      const prior = attMap.get(epoch);
      const dependentRootChanged = prior && !this.config.types.Root.equals(prior.dependentRoot, dependentRoot);

      if (!prior || dependentRootChanged) {
        const dutyAndProof = await this.getDutyAndProof(duty);

        // Using `alreadyWarnedReorg` avoids excessive logs.
        attMap.set(epoch, {dependentRoot, dutyAndProof});
        if (prior && dependentRootChanged && !alreadyWarnedReorg) {
          alreadyWarnedReorg = true;
          this.logger.warn("Attester duties re-org. This may happen from time to time", {
            priorDependentRoot: toHexString(prior.dependentRoot),
            dependentRoot: toHexString(dependentRoot),
          });
        }
      }
    }
  }

  private async getDutyAndProof(duty: phase0.AttesterDuty): Promise<DutyAndProof> {
    const selectionProof = await this.validatorStore.produceSelectionProof(duty.pubkey, duty.slot);

    const modulo = getAggregatorModulo(this.config, duty);
    const isAggregator = isValidatorAggregator(selectionProof, modulo);

    return {
      duty,
      // selectionProof === null is used to check if is aggregator
      selectionProof: isAggregator ? selectionProof : null,
    };
  }
}

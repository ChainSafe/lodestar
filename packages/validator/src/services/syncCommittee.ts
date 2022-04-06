import {AbortSignal} from "@chainsafe/abort-controller";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Slot, CommitteeIndex, altair, Root} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {Api} from "@chainsafe/lodestar-api";
import {IClock, extendError, ILoggerVc} from "../util/index.js";
import {ValidatorStore} from "./validatorStore.js";
import {SyncCommitteeDutiesService, SyncDutyAndProofs} from "./syncCommitteeDuties.js";
import {groupSyncDutiesBySubcommitteeIndex, SubcommitteeDuty} from "./utils.js";
import {IndicesService} from "./indices.js";
import {ChainHeaderTracker} from "./chainHeaderTracker.js";
import {PubkeyHex} from "../types.js";

/**
 * Service that sets up and handles validator sync duties.
 */
export class SyncCommitteeService {
  private readonly dutiesService: SyncCommitteeDutiesService;

  constructor(
    private readonly config: IChainForkConfig,
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly chainHeaderTracker: ChainHeaderTracker,
    indicesService: IndicesService
  ) {
    this.dutiesService = new SyncCommitteeDutiesService(config, logger, api, clock, validatorStore, indicesService);

    // At most every slot, check existing duties from SyncCommitteeDutiesService and run tasks
    clock.runEverySlot(this.runSyncCommitteeTasks);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  private runSyncCommitteeTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    try {
      // Before altair fork no need to check duties
      if (computeEpochAtSlot(slot) < this.config.ALTAIR_FORK_EPOCH) {
        return;
      }

      // Fetch info first so a potential delay is absorved by the sleep() below
      const dutiesAtSlot = await this.dutiesService.getDutiesAtSlot(slot);
      if (dutiesAtSlot.length === 0) {
        return;
      }

      // Lighthouse recommends to always wait to 1/3 of the slot, even if the block comes early
      await sleep(this.clock.msToSlotFraction(slot, 1 / 3), signal);

      // Step 1. Download, sign and publish an `SyncCommitteeMessage` for each validator.
      //         Differs from AttestationService, `SyncCommitteeMessage` are equal for all
      const beaconBlockRoot = await this.produceAndPublishSyncCommittees(slot, dutiesAtSlot);

      // Step 2. If an attestation was produced, make an aggregate.
      // First, wait until the `aggregation_production_instant` (2/3rds of the way though the slot)
      await sleep(this.clock.msToSlotFraction(slot, 2 / 3), signal);

      // await for all so if the Beacon node is overloaded it auto-throttles
      // TODO: This approach is convervative to reduce the node's load, review
      const dutiesBySubcommitteeIndex = groupSyncDutiesBySubcommitteeIndex(dutiesAtSlot);
      await Promise.all(
        Array.from(dutiesBySubcommitteeIndex.entries()).map(async ([subcommitteeIndex, duties]) => {
          if (duties.length === 0) return;
          // Then download, sign and publish a `SignedAggregateAndProof` for each
          // validator that is elected to aggregate for this `slot` and `subcommitteeIndex`.
          await this.produceAndPublishAggregates(slot, subcommitteeIndex, beaconBlockRoot, duties).catch((e: Error) => {
            this.logger.error("Error on SyncCommitteeContribution", {slot, index: subcommitteeIndex}, e);
          });
        })
      );
    } catch (e) {
      this.logger.error("Error on runSyncCommitteeTasks", {slot}, e as Error);
    }
  };

  /**
   * Performs the first step of the attesting process: downloading `SyncCommittee` objects,
   * signing them and returning them to the validator.
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/validator.md#attesting
   *
   * Only one `SyncCommittee` is downloaded from the BN. It is then signed by each
   * validator and the list of individually-signed `SyncCommittee` objects is returned to the BN.
   */
  private async produceAndPublishSyncCommittees(slot: Slot, duties: SyncDutyAndProofs[]): Promise<Root> {
    const logCtx = {slot};

    // /eth/v1/beacon/blocks/:blockId/root -> at slot -1

    // Produce one attestation data per slot and subcommitteeIndex
    // Spec: the validator should prepare a SyncCommitteeMessage for the previous slot (slot - 1)
    // as soon as they have determined the head block of slot - 1

    let blockRoot = this.chainHeaderTracker.getCurrentChainHead(slot);
    if (blockRoot === null) {
      const blockRootData = await this.api.beacon.getBlockRoot("head").catch((e: Error) => {
        throw extendError(e, "Error producing SyncCommitteeMessage");
      });
      blockRoot = blockRootData.data;
    }

    const signatures: altair.SyncCommitteeMessage[] = [];

    for (const {duty} of duties) {
      const logCtxValidator = {...logCtx, validatorIndex: duty.validatorIndex};
      try {
        signatures.push(
          await this.validatorStore.signSyncCommitteeSignature(duty.pubkey, duty.validatorIndex, slot, blockRoot)
        );
        this.logger.debug("Signed SyncCommitteeMessage", logCtxValidator);
      } catch (e) {
        this.logger.error("Error signing SyncCommitteeMessage", logCtxValidator, e as Error);
      }
    }

    if (signatures.length > 0) {
      try {
        await this.api.beacon.submitPoolSyncCommitteeSignatures(signatures);
        this.logger.info("Published SyncCommitteeMessage", {...logCtx, count: signatures.length});
      } catch (e) {
        this.logger.error("Error publishing SyncCommitteeMessage", logCtx, e as Error);
      }
    }

    return blockRoot;
  }

  /**
   * Performs the second step of the attesting process: downloading an aggregated `SyncCommittee`,
   * converting it into a `SignedAggregateAndProof` and returning it to the BN.
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/validator.md#broadcast-aggregate
   *
   * Only one aggregated `SyncCommittee` is downloaded from the BN. It is then signed
   * by each validator and the list of individually-signed `SignedAggregateAndProof` objects is
   * returned to the BN.
   */
  private async produceAndPublishAggregates(
    slot: Slot,
    subcommitteeIndex: CommitteeIndex,
    beaconBlockRoot: Root,
    duties: SubcommitteeDuty[]
  ): Promise<void> {
    const logCtx = {slot, index: subcommitteeIndex};

    // No validator is aggregator, skip
    if (duties.every(({selectionProof}) => selectionProof === null)) {
      return;
    }

    this.logger.verbose("Producing SyncCommitteeContribution", logCtx);
    const contribution = await this.api.validator
      .produceSyncCommitteeContribution(slot, subcommitteeIndex, beaconBlockRoot)
      .catch((e: Error) => {
        throw extendError(e, "Error producing SyncCommitteeContribution");
      });

    const signedContributions: altair.SignedContributionAndProof[] = [];

    for (const {duty, selectionProof} of duties) {
      const logCtxValidator = {...logCtx, validatorIndex: duty.validatorIndex};
      try {
        // Produce signed contributions only for validators that are subscribed aggregators.
        if (selectionProof !== null) {
          signedContributions.push(
            await this.validatorStore.signContributionAndProof(duty, selectionProof, contribution.data)
          );
          this.logger.debug("Signed SyncCommitteeContribution", logCtxValidator);
        }
      } catch (e) {
        this.logger.error("Error signing SyncCommitteeContribution", logCtxValidator, e as Error);
      }
    }

    if (signedContributions.length > 0) {
      try {
        await this.api.validator.publishContributionAndProofs(signedContributions);
        this.logger.info("Published SyncCommitteeContribution", {...logCtx, count: signedContributions.length});
      } catch (e) {
        this.logger.error("Error publishing SyncCommitteeContribution", logCtx, e as Error);
      }
    }
  }
}

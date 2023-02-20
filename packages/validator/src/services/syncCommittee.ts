import {ChainForkConfig} from "@lodestar/config";
import {Slot, CommitteeIndex, altair, Root} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Api, ApiError} from "@lodestar/api";
import {IClock, LoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {ValidatorStore} from "./validatorStore.js";
import {SyncCommitteeDutiesService, SyncDutyAndProofs} from "./syncCommitteeDuties.js";
import {groupSyncDutiesBySubcommitteeIndex, SubcommitteeDuty} from "./utils.js";
import {ChainHeaderTracker} from "./chainHeaderTracker.js";
import {ValidatorEventEmitter} from "./emitter.js";

type SyncCommitteeServiceOpts = {
  scAfterBlockDelaySlotFraction?: number;
};

/**
 * Service that sets up and handles validator sync duties.
 */
export class SyncCommitteeService {
  private readonly dutiesService: SyncCommitteeDutiesService;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: Api,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly emitter: ValidatorEventEmitter,
    private readonly chainHeaderTracker: ChainHeaderTracker,
    private readonly metrics: Metrics | null,
    private readonly opts?: SyncCommitteeServiceOpts
  ) {
    this.dutiesService = new SyncCommitteeDutiesService(config, logger, api, clock, validatorStore, metrics);

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

      // Fetch info first so a potential delay is absorbed by the sleep() below
      const dutiesAtSlot = await this.dutiesService.getDutiesAtSlot(slot);
      if (dutiesAtSlot.length === 0) {
        return;
      }

      // unlike Attestation, SyncCommitteeSignature could be published asap
      // especially with lodestar, it's very busy at 1/3 of slot
      // see https://github.com/ChainSafe/lodestar/issues/4608
      await Promise.race([sleep(this.clock.msToSlot(slot + 1 / 3), signal), this.emitter.waitForBlockSlot(slot)]);
      this.metrics?.syncCommitteeStepCallProduceMessage.observe(this.clock.secFromSlot(slot + 1 / 3));

      // Step 1. Download, sign and publish an `SyncCommitteeMessage` for each validator.
      //         Differs from AttestationService, `SyncCommitteeMessage` are equal for all
      const beaconBlockRoot = await this.produceAndPublishSyncCommittees(slot, dutiesAtSlot);

      // Step 2. If an attestation was produced, make an aggregate.
      // First, wait until the `aggregation_production_instant` (2/3rds of the way though the slot)
      await sleep(this.clock.msToSlot(slot + 2 / 3), signal);
      this.metrics?.syncCommitteeStepCallProduceAggregate.observe(this.clock.secFromSlot(slot + 2 / 3));

      // await for all so if the Beacon node is overloaded it auto-throttles
      // TODO: This approach is conservative to reduce the node's load, review
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
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/validator.md#sync-committee-messages
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

    const blockRoot: Uint8Array =
      this.chainHeaderTracker.getCurrentChainHead(slot) ??
      (await this.api.beacon.getBlockRoot("head").then((res) => {
        ApiError.assert(res, "Error producing SyncCommitteeMessage");
        return res.response.data.root;
      }));

    const signatures: altair.SyncCommitteeMessage[] = [];

    await Promise.all(
      duties.map(async ({duty}) => {
        const logCtxValidator = {...logCtx, validatorIndex: duty.validatorIndex};
        try {
          signatures.push(
            await this.validatorStore.signSyncCommitteeSignature(duty.pubkey, duty.validatorIndex, slot, blockRoot)
          );
          this.logger.debug("Signed SyncCommitteeMessage", logCtxValidator);
        } catch (e) {
          this.logger.error("Error signing SyncCommitteeMessage", logCtxValidator, e as Error);
        }
      })
    );

    // by default we want to submit SyncCommitteeSignature asap after we receive block
    // provide a delay option just in case any client implementation validate the existence of block in
    // SyncCommitteeSignature gossip validation.
    const msToOneThirdSlot = this.clock.msToSlot(slot + 1 / 3);
    const afterBlockDelayMs = 1000 * this.clock.secondsPerSlot * (this.opts?.scAfterBlockDelaySlotFraction ?? 0);
    const toDelayMs = Math.min(msToOneThirdSlot, afterBlockDelayMs);
    if (toDelayMs > 0) {
      await sleep(toDelayMs);
    }

    this.metrics?.syncCommitteeStepCallPublishMessage.observe(this.clock.secFromSlot(slot + 1 / 3));

    if (signatures.length > 0) {
      try {
        ApiError.assert(await this.api.beacon.submitPoolSyncCommitteeSignatures(signatures));
        this.logger.info("Published SyncCommitteeMessage", {...logCtx, count: signatures.length});
        this.metrics?.publishedSyncCommitteeMessage.inc(signatures.length);
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
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/validator.md#sync-committee-contributions
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
    const res = await this.api.validator.produceSyncCommitteeContribution(slot, subcommitteeIndex, beaconBlockRoot);
    ApiError.assert(res, "Error producing sync committee contribution during produceAndPublishAggregates");

    const signedContributions: altair.SignedContributionAndProof[] = [];

    await Promise.all(
      duties.map(async ({duty, selectionProof}) => {
        const logCtxValidator = {...logCtx, validatorIndex: duty.validatorIndex};
        try {
          // Produce signed contributions only for validators that are subscribed aggregators.
          if (selectionProof !== null) {
            signedContributions.push(
              await this.validatorStore.signContributionAndProof(duty, selectionProof, res.response.data)
            );
            this.logger.debug("Signed SyncCommitteeContribution", logCtxValidator);
          }
        } catch (e) {
          this.logger.error("Error signing SyncCommitteeContribution", logCtxValidator, e as Error);
        }
      })
    );

    this.metrics?.syncCommitteeStepCallPublishAggregate.observe(this.clock.secFromSlot(slot + 2 / 3));

    if (signedContributions.length > 0) {
      try {
        const res = await this.api.validator.publishContributionAndProofs(signedContributions);
        ApiError.assert(res);
        this.logger.info("Published SyncCommitteeContribution", {...logCtx, count: signedContributions.length});
        this.metrics?.publishedSyncCommitteeContribution.inc(signedContributions.length);
      } catch (e) {
        this.logger.error("Error publishing SyncCommitteeContribution", logCtx, e as Error);
      }
    }
  }
}

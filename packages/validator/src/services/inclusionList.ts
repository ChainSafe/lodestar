import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {Slot, bellatrix, heze} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {PubkeyHex} from "../types.js";
import {IClock, LoggerVc} from "../util/index.js";
import {ChainHeaderTracker} from "./chainHeaderTracker.js";
import {ValidatorEventEmitter} from "./emitter.js";
import {InclusionListDutiesService} from "./inclusionListDuties.js";
import {SyncingStatusTracker} from "./syncingStatusTracker.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * Service that sets up and handles validator inclusion list duties.
 */
export class InclusionListService {
  private readonly dutiesService: InclusionListDutiesService;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    chainHeadTracker: ChainHeaderTracker,
    syncingStatusTracker: SyncingStatusTracker,
    private readonly emitter: ValidatorEventEmitter
  ) {
    this.dutiesService = new InclusionListDutiesService(
      config,
      logger,
      api,
      clock,
      validatorStore,
      chainHeadTracker,
      syncingStatusTracker
    );

    // At most every slot, check existing duties from InclusionListDutiesService and run tasks
    clock.runEverySlot(this.runInclusionListTasks);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  private runInclusionListTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    // Fetch info first so a potential delay is absorbed by the sleep() below
    const duties = this.dutiesService.getDutiesAtSlot(slot);
    if (duties.length === 0) {
      return;
    }
    const fork = this.config.getForkName(slot);

    // Spec heze/validator.md: broadcast the signed inclusion list by `get_inclusion_list_due_ms()`
    // (~67% of slot) "built against the block for the current slot if it has been processed and
    // confirmed as head, or against the local head returned by `get_head()` otherwise". Submit on
    // whichever fires first:
    //   (a) `executionPayloadImported` for `slot` — the EL has applied the slot's payload, so the
    //       mempool view we'll query is post-slot. Note: if the import already completed before we
    //       were scheduled, the helper short-circuits via its tracked latest-imported slot.
    //   (b) the IL submission deadline — fallback for empty / missed slots, or when import is late.
    const dueMs = Math.max(0, this.config.getInclusionListSubmissionDueMs(fork) - this.clock.msFromSlot(slot));
    // Need to broadcast before deadline to ensure ILs are considered by attesters
    const beforeDueMs = 1000;
    await Promise.race([sleep(dueMs - beforeDueMs, signal), this.emitter.waitForExecutionPayloadImportedSlot(slot)]);

    // If there is more than one duty, all validators on duty will sign and publish the same IL
    const inclusionListTransactions = await this.produceInclusionList(slot);

    await this.signAndPublishInclusionList(inclusionListTransactions, duties);
  };

  // Note: The inclusion list returned here is a "blueprint" ie. every field
  // is filled except validator index = 0. Need to replace validator index to
  // form a valid InclusionList
  private async produceInclusionList(slot: Slot): Promise<bellatrix.Transactions> {
    // Produce one IL per slot
    return (await this.api.validator.produceInclusionList({slot})).value();
  }

  /**
   * Only one `InclusionList` is downloaded from the BN. It is then signed by each
   * validator and the list of individually-signed `InclusionList` objects is returned to the BN.
   */

  private async signAndPublishInclusionList(
    inclusionListTransactions: bellatrix.Transactions,
    duties: routes.validator.InclusionListDutyList
  ) {
    const signedInclusionLists: heze.SignedInclusionList[] = [];

    await Promise.all(
      duties.map(async (duty) => {
        const inclusionList: heze.InclusionList = {
          slot: duty.slot,
          validatorIndex: duty.validatorIndex,
          inclusionListCommitteeRoot: duty.inclusionListCommitteeRoot,
          transactions: inclusionListTransactions,
        };
        // TODO HEZE: Log and log context here
        try {
          signedInclusionLists.push(await this.validatorStore.signInclusionList(duty, inclusionList));
        } catch (e) {
          this.logger.error("Error signing inclusion list", {slot: duty.slot}, e as Error);
        }
      })
    );

    // Publish ILs right away
    for (const signedInclusionList of signedInclusionLists) {
      const {slot, validatorIndex, transactions} = signedInclusionList.message;
      try {
        (await this.api.validator.publishInclusionList({signedInclusionList})).assertOk();
        this.logger.info("Published inclusionList", {
          slot,
          validatorIndex,
          transactions: transactions.length,
        });
      } catch (e) {
        this.logger.error("Error publishing inclusionList", {slot}, e as Error);
      }
    }
  }
}

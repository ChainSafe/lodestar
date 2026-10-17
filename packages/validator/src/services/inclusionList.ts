import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {IClock} from "@lodestar/state-transition";
import {Slot, bellatrix, heze} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {PubkeyHex} from "../types.js";
import {LoggerVc} from "../util/index.js";
import {ChainHeaderTracker} from "./chainHeaderTracker.js";
import {ExecutionPayloadImportedEventData, ValidatorEvent, ValidatorEventEmitter} from "./emitter.js";
import {InclusionListDutiesService} from "./inclusionListDuties.js";
import {SyncingStatusTracker} from "./syncingStatusTracker.js";
import {ValidatorStore} from "./validatorStore.js";

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
    if (this.dutiesService.getDutiesAtSlot(slot).length === 0) {
      return;
    }
    // Spec: broadcast by get_inclusion_list_due_ms(). Wait until the beacon node imported the slot's payload,
    // emitted once the execution client verified it and the fork choice update was queued, so the list is built
    // from a mempool without that payload's transactions. Fall back to the deadline for empty or late slots.
    const dueMs = Math.max(
      0,
      this.config.getInclusionListDueMs(this.config.getForkName(slot)) - this.clock.msFromSlot(slot)
    );
    // Publish ahead of the deadline so the list still counts as timely for peers
    const beforeDueMs = 1000;
    let resolvePayloadImported = (): void => {};
    const payloadImported = new Promise<void>((resolve) => {
      resolvePayloadImported = resolve;
    });
    const onPayloadImported = (payload: ExecutionPayloadImportedEventData): void => {
      if (payload.slot === slot) {
        resolvePayloadImported();
      }
    };
    this.emitter.on(ValidatorEvent.executionPayloadImported, onPayloadImported);
    try {
      await Promise.race([sleep(Math.max(0, dueMs - beforeDueMs), signal), payloadImported]);
    } finally {
      this.emitter.off(ValidatorEvent.executionPayloadImported, onPayloadImported);
    }

    const inclusionListTransactions = await this.produceInclusionList(slot);

    // Empty lists are ignored by gossip validation (consensus-specs#5576)
    if (inclusionListTransactions.length === 0) {
      this.logger.debug("Produced inclusion list has no transactions, skipping publish", {slot});
      return;
    }

    // Read the duties after the wait, a reorg handled meanwhile may have changed the dependent root
    const duties = this.dutiesService.getDutiesAtSlot(slot);
    if (duties.length === 0) {
      return;
    }

    await this.signAndPublishInclusionList(inclusionListTransactions, duties);
  };

  private async produceInclusionList(slot: Slot): Promise<bellatrix.Transactions> {
    return (await this.api.validator.produceInclusionList({slot})).value();
  }

  /** One inclusion list per slot, signed by every validator on duty */
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
          dependentRoot: duty.dependentRoot,
          transactions: inclusionListTransactions,
        };
        try {
          signedInclusionLists.push(await this.validatorStore.signInclusionList(duty, inclusionList));
        } catch (e) {
          this.logger.error(
            "Error signing inclusion list",
            {slot: duty.slot, validatorIndex: duty.validatorIndex},
            e as Error
          );
        }
      })
    );

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
        this.logger.error(
          "Error publishing inclusionList",
          {slot, validatorIndex, transactions: transactions.length},
          e as Error
        );
      }
    }
  }
}

import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {IClock} from "@lodestar/state-transition";
import {Slot, bellatrix, heze} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {PubkeyHex} from "../types.js";
import {LoggerVc} from "../util/index.js";
import {ChainHeaderTracker} from "./chainHeaderTracker.js";
import {ExecutionPayloadAvailableEventData, ValidatorEvent, ValidatorEventEmitter} from "./emitter.js";
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
    // Fetch info first so a potential delay is absorbed by the sleep() below
    const duties = this.dutiesService.getDutiesAtSlot(slot);
    if (duties.length === 0) {
      return;
    }
    // Spec: broadcast by get_inclusion_list_due_ms(), built against the slot's block if processed, else the
    // local head. Wait until the beacon node reports the slot's payload available, which it emits before
    // execution validation, or fall back to the deadline for empty or late slots.
    const dueMs = Math.max(0, this.config.getInclusionListDueMs() - this.clock.msFromSlot(slot));
    // Publish ahead of the deadline so the list still counts as timely for peers
    const beforeDueMs = 1000;
    let resolvePayloadAvailable = (): void => {};
    const payloadAvailable = new Promise<void>((resolve) => {
      resolvePayloadAvailable = resolve;
    });
    const onPayloadAvailable = (payload: ExecutionPayloadAvailableEventData): void => {
      if (payload.slot === slot) {
        resolvePayloadAvailable();
      }
    };
    this.emitter.on(ValidatorEvent.executionPayloadAvailable, onPayloadAvailable);
    try {
      await Promise.race([sleep(Math.max(0, dueMs - beforeDueMs), signal), payloadAvailable]);
    } finally {
      this.emitter.off(ValidatorEvent.executionPayloadAvailable, onPayloadAvailable);
    }

    const inclusionListTransactions = await this.produceInclusionList(slot);

    // Empty lists are ignored by gossip validation (consensus-specs#5576)
    if (inclusionListTransactions.length === 0) {
      this.logger.debug("Produced inclusion list has no transactions, skipping publish", {slot});
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
          this.logger.error("Error signing inclusion list", {slot: duty.slot}, e as Error);
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
        this.logger.error("Error publishing inclusionList", {slot}, e as Error);
      }
    }
  }
}

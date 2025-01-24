import {ApiClient} from "@lodestar/api";
import {InclusionListDutyList} from "@lodestar/api/lib/beacon/routes/validator.js";
import {ChainForkConfig} from "@lodestar/config";
import {Slot, focil} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
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
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly emitter: ValidatorEventEmitter,
    chainHeadTracker: ChainHeaderTracker,
    syncingStatusTracker: SyncingStatusTracker
  ) {
    this.dutiesService = new InclusionListDutiesService(
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

  private runInclusionListTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    // Fetch info first so a potential delay is absorbed by the sleep() below
    const duties = this.dutiesService.getDutiesAtSlot(slot);
    if (duties.length === 0) {
      return;
    }

    // A validator should create and broadcast the IL when either
    // (a) the validator has received a valid block from the expected block proposer for the assigned slot or
    // (b) one-third of the slot has transpired (SECONDS_PER_SLOT / 3 seconds after the start of slot) -- whichever comes first.
    // TODO FOCIL: Review this timing. Spec says only mandates us to broadcast before 11s
    await Promise.race([sleep(this.clock.msToSlot(slot + 1 / 3), signal), this.emitter.waitForBlockSlot(slot)]);

    // If there is more than one duty, all validators on duty will sign and publish the same IL
    const inclusionListNoValidatorIndex = await this.produceInclusionList(slot);

    await this.signAndPublishInclusionList(inclusionListNoValidatorIndex, duties);
  };

  // Note: The inclusion list returned here is a "blueprint" ie. every field
  // is filled except validator index = 0. Need to replace validator index to
  // form a valid InclusionList
  private async produceInclusionList(slot: Slot): Promise<focil.InclusionList> {
    // Produce one IL per slot
    return (await this.api.validator.produceInclusionList({slot})).value();
  }

  /**
   * Only one `InclusionList` is downloaded from the BN. It is then signed by each
   * validator and the list of individually-signed `InclusionList` objects is returned to the BN.
   */

  private async signAndPublishInclusionList(
    inclusionListNoValidatorIndex: focil.InclusionList,
    duties: InclusionListDutyList
  ) {
    const signedInclusionLists: focil.SignedInclusionList[] = [];

    await Promise.all(
      duties.map(async (duty) => {
        // TODO FOCIL: Log and log context here
        try {
          signedInclusionLists.push(await this.validatorStore.signInclusionList(duty, inclusionListNoValidatorIndex));
        } catch (e) {
          this.logger.error("Error signing inclusiont list");
        }
      })
    );

    // Publish ILs right away
    for (const signedInclusionList of signedInclusionLists) {
      try {
        (await this.api.validator.publishInclusionList({signedInclusionList})).assertOk();
        this.logger.info(`Published inclusionList ${signedInclusionList.message}`);
      } catch (e) {
        this.logger.error("Error publishing inclusionList");
      }
    }
  }
}

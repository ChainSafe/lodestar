import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {isForkPostGloas} from "@lodestar/params";
import {Slot, gloas} from "@lodestar/types";
import {prettyBytes, sleep, toRootHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {PubkeyHex} from "../types.js";
import {IClock, LoggerVc} from "../util/index.js";
import {ChainHeaderTracker} from "./chainHeaderTracker.js";
import {ValidatorEventEmitter} from "./emitter.js";
import {PtcDutiesService} from "./ptcDuties.js";
import {SyncingStatusTracker} from "./syncingStatusTracker.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * Service that sets up and handles validator Payload Timeliness Committee duties.
 */
export class PtcService {
  private readonly dutiesService: PtcDutiesService;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly emitter: ValidatorEventEmitter,
    chainHeadTracker: ChainHeaderTracker,
    syncingStatusTracker: SyncingStatusTracker,
    private readonly metrics: Metrics | null
  ) {
    this.dutiesService = new PtcDutiesService(
      config,
      logger,
      api,
      clock,
      validatorStore,
      chainHeadTracker,
      syncingStatusTracker,
      metrics
    );

    clock.runEverySlot(this.runPtcTasks);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  private runPtcTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    const fork = this.config.getForkName(slot);
    if (!isForkPostGloas(fork)) {
      return;
    }

    const duties = this.dutiesService.getDutiesAtSlot(slot);
    if (duties.length === 0) {
      return;
    }

    const payloadAttestationDueMs = this.config.getSlotComponentDurationMs(this.config.PAYLOAD_ATTESTATION_DUE_BPS);
    await Promise.race([
      sleep(payloadAttestationDueMs - this.clock.msFromSlot(slot), signal),
      this.emitter.waitForExecutionPayloadAvailableSlot(slot),
    ]);

    this.metrics?.ptcStepCallProducePayloadAttestation.observe(
      this.clock.secFromSlot(slot) - payloadAttestationDueMs / 1000
    );

    try {
      const payloadAttestationData = await this.producePayloadAttestationData(slot);
      await this.signAndPublishPayloadAttestations(slot, payloadAttestationData, duties);
    } catch (e) {
      this.logger.error("Error on PTC routine", {slot}, e as Error);
    }
  };

  private async producePayloadAttestationData(slot: Slot): Promise<gloas.PayloadAttestationData> {
    return (await this.api.validator.producePayloadAttestationData({slot})).value();
  }

  private async signAndPublishPayloadAttestations(
    slot: Slot,
    payloadAttestationData: gloas.PayloadAttestationData,
    duties: routes.validator.PtcDuty[]
  ): Promise<void> {
    const payloadAttestationMessages: gloas.PayloadAttestationMessage[] = [];
    const beaconBlockRootHex = toRootHex(payloadAttestationData.beaconBlockRoot);

    await Promise.all(
      duties.map(async (duty) => {
        const logCtxValidator = {slot, validatorIndex: duty.validatorIndex, beaconBlockRoot: beaconBlockRootHex};
        try {
          payloadAttestationMessages.push(
            await this.validatorStore.signPayloadAttestation(
              duty,
              payloadAttestationData,
              this.clock.getCurrentSlot(),
              this.logger
            )
          );
          this.logger.debug("Signed payload attestation message", logCtxValidator);
        } catch (e) {
          this.metrics?.ptcError.inc({error: "sign"});
          this.logger.error("Error signing payload attestation message", logCtxValidator, e as Error);
        }
      })
    );

    this.metrics?.ptcStepCallPublishPayloadAttestation.observe(
      this.clock.secFromSlot(slot) -
        this.config.getSlotComponentDurationMs(this.config.PAYLOAD_ATTESTATION_DUE_BPS) / 1000
    );

    if (payloadAttestationMessages.length > 0) {
      try {
        (await this.api.beacon.submitPayloadAttestationMessages({payloadAttestationMessages})).assertOk();
        this.logger.info("Published payload attestation messages", {
          slot,
          beaconBlockRoot: prettyBytes(beaconBlockRootHex),
          count: payloadAttestationMessages.length,
        });
        this.metrics?.publishedPayloadAttestations.inc(payloadAttestationMessages.length);
      } catch (e) {
        this.metrics?.ptcError.inc({error: "publish"});
        this.logger.error("Error publishing payload attestation messages", {slot}, e as Error);
      }
    }
  }
}

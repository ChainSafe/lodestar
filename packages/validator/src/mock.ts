import {createIBeaconConfig, IBeaconConfig, IChainForkConfig} from "@lodestar/config";
import {Genesis} from "@lodestar/types/phase0";
import {extendError, ILogger, sleep} from "@lodestar/utils";
import {getClient, Api} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {Clock, IClock} from "./util/clock.js";
import {waitForGenesis} from "./genesis.js";
import {assertEqualParams} from "./util/index.js";
import {ValidatorEventEmitter} from "./services/emitter.js";
import {Metrics} from "./metrics.js";

export type MockValidatorOptions = {
  config: IChainForkConfig;
  api: Api | string | string[];
  logger: ILogger;
  abortController: AbortController;
};

enum Status {
  running,
  closed,
}

/**
 * A mock validator that consistenly produce attestations right at 1/3 of slot to help monitor the I/O lag issue.
 */
export class MockValidator {
  private readonly config: IBeaconConfig;
  private readonly api: Api;
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private state: Status;
  private readonly controller: AbortController;

  constructor(opts: MockValidatorOptions, readonly genesis: Genesis, metrics: Metrics | null = null) {
    const {logger} = opts;
    const config = createIBeaconConfig(opts.config, genesis.genesisValidatorsRoot);
    this.controller = opts.abortController;
    const clock = new Clock(config, logger, {genesisTime: Number(genesis.genesisTime)});

    let api: Api;
    if (typeof opts.api === "string" || Array.isArray(opts.api)) {
      api = getClient(
        {
          urls: typeof opts.api === "string" ? [opts.api] : opts.api,
          // Validator would need the beacon to respond within the slot
          timeoutMs: config.SECONDS_PER_SLOT * 1000,
          getAbortSignal: () => this.controller.signal,
        },
        {config, logger, metrics: metrics?.restApiClient}
      );
    } else {
      api = opts.api;
    }

    const emitter = new ValidatorEventEmitter();
    // Validator event emitter can have more than 10 listeners in a normal course of operation
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    emitter.setMaxListeners(Infinity);

    this.config = config;
    this.logger = logger.child({module: "mock"});
    this.api = api;
    this.clock = clock;

    // "start" the validator
    this.state = Status.running;
    this.clock.start(this.controller.signal);

    this.clock.runEverySlot(this.produceAttestationData);
  }

  get isRunning(): boolean {
    return this.state === Status.running;
  }

  /** Waits for genesis and genesis time */
  static async initializeFromBeaconNode(opts: MockValidatorOptions, metrics?: Metrics | null): Promise<MockValidator> {
    const {config, logger} = opts;

    let api: Api;
    if (typeof opts.api === "string" || Array.isArray(opts.api)) {
      const urls = typeof opts.api === "string" ? [opts.api] : opts.api;
      // This new api instance can make do with default timeout as a faster timeout is
      // not necessary since this instance won't be used for validator duties
      api = getClient({urls, getAbortSignal: () => opts.abortController.signal}, {config, logger});
    } else {
      api = opts.api;
    }

    const genesis = await waitForGenesis(api, opts.logger, opts.abortController.signal);
    logger.info("Genesis fetched from the beacon node");

    const {data: externalSpecJson} = await api.config.getSpec();
    assertEqualParams(config, externalSpecJson);
    logger.info("Verified connected beacon node and validator have same the config");

    return new MockValidator(opts, genesis, metrics);
  }

  /**
   * Stops all validator functions.
   */
  async close(): Promise<void> {
    if (this.state === Status.closed) return;
    this.controller.abort();
    this.state = Status.closed;
  }

  /**
   * Produce attestation data right at 1/3 of slot to monitor I/O lag issue.
   */
  private produceAttestationData = async (slot: Slot): Promise<void> => {
    await sleep(this.clock.msToSlot(slot + 1 / 3));
    // There should be committee index 0 in all committees
    const committeeIndex = 0;
    this.logger.info("Producing attestation data", {slot, committeeIndex});
    await this.api.validator.produceAttestationData(committeeIndex, slot).catch((e: Error) => {
      throw extendError(e, "Error producing attestation");
    });
    this.logger.info("Produced attestation successfully", {slot, committeeIndex});
  };
}

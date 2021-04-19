import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root} from "@chainsafe/lodestar-types";
import {ILogger, IStoppableEventIterable} from "@chainsafe/lodestar-utils";
import {AbortController} from "abort-controller";
import {EventEmitter} from "events";
import {ApiClientOverRest} from "./rest";
import {LocalClock} from "./LocalClock";
import {
  ApiClientEventEmitter,
  IApiClient,
  IApiClientProvider,
  IBeaconClock,
  BeaconEvent,
  BeaconEventType,
  IApiClientValidator,
} from "./interface";

export * from "./interface";

export class ApiClientProvider extends (EventEmitter as {new (): ApiClientEventEmitter}) implements IApiClientProvider {
  clock!: IBeaconClock;
  genesisValidatorsRoot!: Root;

  readonly url: string;
  readonly beacon: IApiClient["beacon"];
  readonly config: IApiClient["config"];
  readonly node: IApiClient["node"];
  readonly events: IApiClient["events"];
  readonly validator: IApiClient["validator"];

  readonly beaconConfig: IBeaconConfig;
  readonly logger: ILogger;
  private controller!: AbortController;

  private api: IApiClientValidator;
  private running = false;
  private beaconNodeInterval?: NodeJS.Timeout;
  private slotCountingTimeout?: NodeJS.Timeout;
  private genesisTime?: number;
  private stream?: IStoppableEventIterable<BeaconEvent>;
  private streamPromise?: Promise<void>;

  constructor(config: IBeaconConfig, logger: ILogger, apiOpt: string | IApiClient) {
    super();
    this.beaconConfig = config;
    this.logger = logger;
    this.url = typeof apiOpt === "string" ? apiOpt : "inmemory";
    this.api = typeof apiOpt === "string" ? ApiClientOverRest(config, apiOpt) : apiOpt;
    this.beacon = this.api.beacon;
    this.config = this.api.config;
    this.node = this.api.node;
    this.events = this.api.events;
    this.validator = this.api.validator;
  }

  async connect(): Promise<void> {
    if (!this.beaconNodeInterval) {
      this.controller = new AbortController();
      this.running = true;
      this.beaconNodeInterval = setInterval(this.pollBeaconNode.bind(this), 3000);
      if (this.api.registerAbortSignal) this.api.registerAbortSignal(this.controller.signal);
    }
  }

  async disconnect(): Promise<void> {
    this.running = false;
    if (this.beaconNodeInterval) {
      clearInterval(this.beaconNodeInterval);
    }
    if (this.slotCountingTimeout) {
      clearTimeout(this.slotCountingTimeout);
    }
    if (this.stream) {
      this.stream.stop();
    }
    this.controller.abort();
  }

  private async pollBeaconNode(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info("Checking genesis time and beacon node connection");
    const genesis = await this.beacon.getGenesis();
    if (genesis && Math.floor(Date.now() / 1000) >= genesis.genesisTime) {
      if (this.beaconNodeInterval) {
        clearInterval(this.beaconNodeInterval);
      }
      this.genesisValidatorsRoot = genesis.genesisValidatorsRoot;
      this.startSlotCounting(Number(genesis.genesisTime));
      this.emit("beaconChainStarted");
    } else {
      let waitTime = "unknown";
      if (genesis) {
        waitTime = genesis.genesisTime - BigInt(Math.floor(Date.now() / 1000)) + "s";
      }
      this.logger.info("Waiting for genesis time", {waitTime});
    }
  }

  private startSlotCounting(genesisTime: number): void {
    this.genesisTime = genesisTime;
    this.stream = this.events.getEventStream([
      BeaconEventType.BLOCK,
      BeaconEventType.HEAD,
      BeaconEventType.CHAIN_REORG,
    ]);
    this.streamPromise = pipeToEmitter(this.stream!, this);
    // CLOCK_SLOT and CLOCK_EPOCH currently being emitted from this LocalClock
    this.clock = new LocalClock({
      config: this.beaconConfig,
      genesisTime,
      emitter: this,
      signal: this.controller.signal,
    });
  }
}

async function pipeToEmitter<
  T extends BeaconEvent["type"] = BeaconEventType.BLOCK | BeaconEventType.HEAD | BeaconEventType.CHAIN_REORG
>(stream: IStoppableEventIterable<BeaconEvent>, emitter: ApiClientEventEmitter): Promise<void> {
  for await (const evt of stream) {
    emitter.emit<BeaconEvent["type"], ApiClientEventEmitter>(
      evt.type,
      evt.message as ({type: T} extends BeaconEvent ? BeaconEvent : never)["message"]
    );
  }
}

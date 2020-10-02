import {AbortController} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiClientEventEmitter, IApiClient, IBeaconClock} from "./interface";
import {IBeaconApi} from "./interface/beacon";
import {IValidatorApi} from "./interface/validators";
import {EventEmitter} from "events";
import {INodeApi} from "./interface/node";
import {ILogger} from "@chainsafe/lodestar-utils";
import {BeaconEventEmitter, BeaconEventType, IEventsApi} from "./interface/events";
import {LocalClock} from "./LocalClock";

export abstract class AbstractApiClient extends (EventEmitter as {new (): ApiClientEventEmitter})
  implements IApiClient {
  public clock!: IBeaconClock;
  public emitter!: BeaconEventEmitter;

  protected config: IBeaconConfig;
  protected logger: ILogger;
  private controller!: AbortController;

  private running = false;
  private beaconNodeInterval?: NodeJS.Timeout;
  private slotCountingTimeout?: NodeJS.Timeout;
  private genesisTime?: number;

  public abstract url: string;
  abstract beacon: IBeaconApi;
  abstract node: INodeApi;
  abstract events: IEventsApi;
  abstract validator: IValidatorApi;

  protected constructor(config: IBeaconConfig, logger: ILogger) {
    super();
    this.config = config;
    this.logger = logger;
  }

  public async connect(): Promise<void> {
    if (!this.beaconNodeInterval) {
      this.controller = new AbortController();
      this.running = true;
      await this.pollBeaconNode();
      this.beaconNodeInterval = setInterval(this.pollBeaconNode.bind(this), 3000);
    }
  }

  public async disconnect(): Promise<void> {
    this.running = false;
    if (this.beaconNodeInterval) {
      clearInterval(this.beaconNodeInterval);
    }
    if (this.slotCountingTimeout) {
      clearTimeout(this.slotCountingTimeout);
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
    this.emitter = this.events.getEventEmitter(
      [BeaconEventType.BLOCK, BeaconEventType.HEAD, BeaconEventType.CLOCK_SLOT],
      this.controller.signal
    );
    this.clock = new LocalClock({
      config: this.config,
      genesisTime,
      emitter: this.emitter,
      signal: this.controller.signal,
    });
  }
}

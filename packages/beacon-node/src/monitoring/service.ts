import {Registry} from "prom-client";
import {ILogger, sleep} from "@lodestar/utils";
import {MonitoringOptions} from "./options.js";
import {createClientStats} from "./clientStats.js";
import {ProcessType} from "./types.js";

/** Interval between sending client stats */
export const MONITORING_UPDATE_INTERVAL_SECONDS = 60;

/** Initial delay before client stats are sent */
export const MONITORING_INITIAL_DELAY_SECONDS = 30;

type MonitoringData = Record<string, string | number | boolean>;

type RemoteServerError = {
  status: string;
  data: null;
};

/**
 * Service for sending clients stats to a remote server (e.g. beaconcha.in)
 */
export class MonitoringService {
  private readonly register: Registry;
  private readonly logger: ILogger;

  private sendDataInterval?: NodeJS.Timeout;

  constructor(
    private readonly processes: ProcessType[],
    private readonly opts: MonitoringOptions,
    {register, logger}: {register: Registry; logger: ILogger}
  ) {
    if (!opts.endpoint) {
      throw new Error("Monitoring endpoint must be provided");
    }

    // TODO: validate if URL is properly formatted?

    this.logger = logger;
    this.register = register;
  }

  start(delaySeconds = MONITORING_INITIAL_DELAY_SECONDS): void {
    if (this.sendDataInterval) {
      throw new Error("Monitoring service is already started");
    }

    const {endpoint, interval} = this.opts;
    const updateInterval = interval ?? MONITORING_UPDATE_INTERVAL_SECONDS;

    sleep(delaySeconds * 1000).finally(async () => {
      await this.sendData();

      this.sendDataInterval = setInterval(async () => {
        await this.sendData();
      }, updateInterval * 1000);
    });

    // TODO: endpoint contains sensitive API key and should probably not be logged
    this.logger.info("Started monitoring service", {endpoint, interval: `${updateInterval}s`});
  }

  stop(): void {
    if (this.sendDataInterval) {
      clearInterval(this.sendDataInterval);
      this.sendDataInterval = undefined;
    }
  }

  private async sendData(): Promise<void> {
    try {
      const data = await this.collectData();

      // TODO: add AbortController? see JsonRpcHttpCLient
      const res = await fetch(this.opts.endpoint, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = (await res.json()) as RemoteServerError;
        this.logger.error(error.status);
      } else {
        this.logger.info(`Sent client stats to remote server: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      this.logger.error("Error sending client stats", {}, e as Error);
    }
  }

  private async collectData(): Promise<MonitoringData[]> {
    const stats = createClientStats(this.processes);
    const data: MonitoringData[] = [];

    const recordPromises = [];

    for (const [i, s] of stats.entries()) {
      data[i] = {};

      recordPromises.push(
        ...Object.values(s).map(async (property) => {
          const record = await property.getRecord(this.register);
          data[i][record.key] = record.value;
        })
      );
    }

    await Promise.all(recordPromises);

    return data;
  }
}

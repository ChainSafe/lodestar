import {Registry} from "prom-client";
import {ILogger, sleep} from "@lodestar/utils";
import {defaultMonitoringOptions, MonitoringOptions} from "./options.js";
import {createClientStats} from "./clientStats.js";
import {ProcessType} from "./types.js";

type MonitoringData = Record<string, string | number | boolean>;

type RemoteServerError = {
  status: string;
  data: null;
};

/**
 * Service for sending clients stats to a remote server (e.g. beaconcha.in)
 */
export class MonitoringService {
  private readonly remoteHost: string;
  private readonly remoteServerUrl: URL;
  private readonly options: Required<MonitoringOptions>;
  private readonly register: Registry;
  private readonly logger: ILogger;

  private sendDataInterval?: NodeJS.Timeout;

  constructor(
    private readonly processes: ProcessType[],
    options: MonitoringOptions,
    {register, logger}: {register: Registry; logger: ILogger}
  ) {
    this.options = {...defaultMonitoringOptions, ...options};
    this.logger = logger;
    this.register = register;
    this.remoteServerUrl = this.parseMonitoringEndpoint(this.options.endpoint);
    this.remoteHost = this.remoteServerUrl.host;
  }

  start(): void {
    if (this.sendDataInterval) {
      // monitoring service is already started
      return;
    }

    sleep(this.options.initialDelay * 1000).finally(async () => {
      await this.sendData();

      this.sendDataInterval = setInterval(async () => {
        await this.sendData();
      }, this.options.interval * 1000);
    });

    this.logger.info("Started monitoring service", {
      remote: this.remoteHost,
      interval: `${this.options.interval}s`,
    });
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
      const res = await fetch(this.remoteServerUrl, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = (await res.json()) as RemoteServerError;
        this.logger.error(error.status);
      } else {
        this.logger.debug(`Sent client stats to ${this.remoteHost}: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      this.logger.error(`Failed to send client stats to ${this.remoteHost}`, {}, e as Error);
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

  private parseMonitoringEndpoint(endpoint: string): URL {
    if (!endpoint) {
      throw new Error("Monitoring endpoint must be provided");
    }

    try {
      const remoteServerUrl = new URL(endpoint);

      if (!["http:", "https:"].includes(remoteServerUrl.protocol)) {
        throw new Error();
      }

      if (remoteServerUrl.protocol === "http:") {
        this.logger.warn(
          "Insecure monitoring endpoint, please make sure to always use a HTTPS connection in production"
        );
      }

      return remoteServerUrl;
    } catch {
      throw new Error("Monitoring endpoint must be a valid URL");
    }
  }
}

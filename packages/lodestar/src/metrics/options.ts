/**
 * @module metrics
 */
import {IConfigurationModule} from "../util/config";

export interface IMetricsOptions {
  enabled: boolean;
  timeout: number;
  pushGateway: boolean;
  serverPort?: number;
  gatewayUrl?: string;
}

export const MetricsOptions: IConfigurationModule = {
  name: "metrics",
  fields: [
    {
      name: "serverPort",
      type: "number",
      configurable: true,
      process: (input) => parseInt(input),
      cli: {
        flag: "metricsPort",
      },
    },
    {
      name: "boolean",
      type: "bool",
      configurable: true,
      cli: {
        flag: "metricsEnabled"
      }
    }
  ],
};

const config: IMetricsOptions = {
  enabled: false,
  timeout: 5000,
  pushGateway: false,
  serverPort: 5000,
};

export default config;

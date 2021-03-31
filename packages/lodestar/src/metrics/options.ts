/**
 * @module metrics
 */

export interface IMetricsOptions {
  enabled: boolean;
  timeout: number;
  serverPort?: number;
  gatewayUrl?: string;
  listenAddr?: string;
}

export const defaultMetricsOptions: IMetricsOptions = {
  enabled: false,
  timeout: 5000,
  serverPort: 8008,
};

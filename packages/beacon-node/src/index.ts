export {initStateFromAnchorState, initStateFromDb, initStateFromEth1} from "./chain/index.js";
export {BeaconDb, type IBeaconDb} from "./db/index.js";
export {Eth1Provider, type IEth1Provider} from "./eth1/index.js";
export {createNodeJsLibp2p, type NodeJsLibp2pOpts} from "./network/index.js";
export * from "./node/index.js";

// Export metrics utilities to de-duplicate validator metrics
export {
  RegistryMetricCreator,
  collectNodeJSMetrics,
  type HttpMetricsServer,
  getHttpMetricsServer,
} from "./metrics/index.js";

// Export monitoring service to make it usable by validator
export {MonitoringService} from "./monitoring/index.js";

// Export generic RestApi server for CLI
export {RestApiServer} from "./api/rest/base.js";
export type {RestApiServerOpts, RestApiServerModules, RestApiServerMetrics} from "./api/rest/base.js";

// Export type util for CLI - TEMP move to lodestar-types eventually
export {getStateTypeFromBytes, getStateSlotFromBytes} from "./util/multifork.js";

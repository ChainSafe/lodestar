// Export generic RestApi server for CLI

export type {RestApiServerMetrics, RestApiServerModules, RestApiServerOpts} from "./api/rest/base.js";
export {RestApiServer} from "./api/rest/base.js";
export {checkAndPersistAnchorState, initStateFromDb, initStateFromEth1} from "./chain/index.js";
export {BeaconDb, type IBeaconDb} from "./db/index.js";
export {Eth1Provider, type IEth1Provider} from "./eth1/index.js";
// Export metrics utilities to de-duplicate validator metrics
export {
  type HttpMetricsServer,
  RegistryMetricCreator,
  collectNodeJSMetrics,
  getHttpMetricsServer,
} from "./metrics/index.js";
// Export monitoring service to make it usable by validator
export {MonitoringService} from "./monitoring/index.js";
export {type NodeJsLibp2pOpts, createNodeJsLibp2p} from "./network/index.js";
export * from "./node/index.js";
// Export type util for CLI - TEMP move to lodestar-types eventually
export {getStateSlotFromBytes, getStateTypeFromBytes} from "./util/multifork.js";

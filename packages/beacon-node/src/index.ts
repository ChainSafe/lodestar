// Export generic RestApi server for CLI

export type {RestApiServerMetrics, RestApiServerModules, RestApiServerOpts} from "./api/rest/base.js";
export {RestApiServer} from "./api/rest/base.js";
export {checkAndPersistAnchorState, initStateFromDb} from "./chain/index.js";
export {DbCPStateDatastore} from "./chain/stateCache/datastore/db.js";
export {FileCPStateDatastore} from "./chain/stateCache/datastore/file.js";
export {BeaconDb, type IBeaconDb} from "./db/index.js";
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

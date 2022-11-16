/* eslint-disable @typescript-eslint/naming-convention */
import {BeaconBlocksByRoot} from "./v1/BeaconBlocksByRoot.js";
import {BeaconBlocksByRange} from "./v1/BeaconBlocksByRange.js";
import {Goodbye} from "./v1/Goodbye.js";
import {LightClientBootstrap} from "./v1/LightClientBootstrap.js";
import {LightClientFinalityUpdate} from "./v1/LightClientFinalityUpdate.js";
import {LightClientOptimisticUpdate} from "./v1/LightClientOptimisticUpdate.js";
import {LightClientUpdatesByRange} from "./v1/LightClientUpdatesByRange.js";
import {Metadata} from "./v1/Metadata.js";
import {Ping} from "./v1/Ping.js";
import {Status} from "./v1/Status.js";
import {BeaconBlocksByRangeV2} from "./v2/BeaconBlocksByRange.js";
import {BeaconBlocksByRootV2} from "./v2/BeaconBlocksByRoot.js";
import {MetadataV2} from "./v2/Metadata.js";

export default {
  v1: {
    BeaconBlocksByRoot,
    BeaconBlocksByRange,
    Goodbye,
    LightClientBootstrap,
    LightClientFinalityUpdate,
    LightClientOptimisticUpdate,
    LightClientUpdatesByRange,
    Metadata,
    Ping,
    Status,
  },
  v2: {
    BeaconBlocksByRange: BeaconBlocksByRangeV2,
    BeaconBlocksByRoot: BeaconBlocksByRootV2,
    Metadata: MetadataV2,
  },
};

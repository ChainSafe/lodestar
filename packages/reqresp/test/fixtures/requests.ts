import {createIBeaconConfig, IBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {allForks, phase0} from "@lodestar/types";
import * as messages from "../../src/messages/index.js";
import {ProtocolDefinition} from "../../src/types.js";
import {ZERO_HASH} from "../utils/index.js";

// eslint-disable-next-line @typescript-eslint/no-empty-function
const getEmptyHandler = <T = unknown>() => async function* emptyHandler(): AsyncGenerator<T> {};

export const getAllMessages = (
  modules: {config: IBeaconConfig} = {config: createIBeaconConfig(chainConfig, ZERO_HASH)}
): {
  ping: ProtocolDefinition<phase0.Ping, phase0.Ping>;
  goodbye: ProtocolDefinition<phase0.Goodbye, phase0.Goodbye>;
  metadata: ProtocolDefinition<null, allForks.Metadata>;
  status: ProtocolDefinition<phase0.Status, phase0.Status>;
  blocksByRange: ProtocolDefinition<phase0.BeaconBlocksByRangeRequest, allForks.SignedBeaconBlock>;
  blocksByRangeV2: ProtocolDefinition<phase0.BeaconBlocksByRangeRequest, allForks.SignedBeaconBlock>;
  blocksByRoot: ProtocolDefinition<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock>;
  blocksByRootV2: ProtocolDefinition<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock>;
} => ({
  ping: messages.Ping(getEmptyHandler()),
  goodbye: messages.Goodbye(modules, getEmptyHandler()),
  metadata: messages.Metadata(modules, getEmptyHandler()),
  status: messages.Status(modules, getEmptyHandler()),
  blocksByRange: messages.BeaconBlocksByRange(modules, getEmptyHandler()),
  blocksByRangeV2: messages.BeaconBlocksByRangeV2(modules, getEmptyHandler()),
  blocksByRoot: messages.BeaconBlocksByRoot(modules, getEmptyHandler()),
  blocksByRootV2: messages.BeaconBlocksByRootV2(modules, getEmptyHandler()),
});

// export const requestsTestCases = [
//   {id: "status", protocol: getAllMessages.status, requests: [createStatus()]},
//   {id: "goodbye", protocol: getAllMessages.goodbye, requests: [BigInt(0), BigInt(1)]},
//   {id: "ping", protocol: getAllMessages.ping, requests: [BigInt(0), BigInt(1)]},
//   {id: "metadata", protocol: getAllMessages.metadata, requests: []},
//   {id: "blocksByRange", protocol: getAllMessages.blocksByRange, requests: [{startSlot: 10, count: 20, step: 1}]},
//   {id: "blocksByRangeV2", protocol: getAllMessages.blocksByRangeV2, requests: [{startSlot: 10, count: 20, step: 1}]},
//   {id: "blocksByRoot", protocol: getAllMessages.blocksByRoot, requests: [generateRoots(4, 0xda)]},
//   {id: "blocksByRootV2", protocol: getAllMessages.blocksByRootV2, requests: [generateRoots(4, 0xda)]},
// ];

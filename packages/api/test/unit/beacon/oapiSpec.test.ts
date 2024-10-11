import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, it, beforeAll, expect} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {OpenApiFile} from "../../utils/parseOpenApiSpec.js";
import {routes} from "../../../src/beacon/index.js";
import {IgnoredProperty, runTestCheckAgainstSpec} from "../../utils/checkAgainstSpec.js";
import {fetchOpenApiSpec} from "../../utils/fetchOpenApiSpec.js";
// Import all testData and merge below
import {testData as beaconTestData} from "./testData/beacon.js";
import {testData as configTestData} from "./testData/config.js";
import {testData as debugTestData} from "./testData/debug.js";
import {eventTestData, testData as eventsTestData} from "./testData/events.js";
import {testData as lightclientTestData} from "./testData/lightclient.js";
import {testData as nodeTestData} from "./testData/node.js";
import {testData as proofsTestData} from "./testData/proofs.js";
import {testData as validatorTestData} from "./testData/validator.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const version = "v3.0.0-alpha.6";
const openApiFile: OpenApiFile = {
  url: `https://github.com/ethereum/beacon-APIs/releases/download/${version}/beacon-node-oapi.json`,
  filepath: path.join(__dirname, "../../../oapi-schemas/beacon-node-oapi.json"),
  version: RegExp(version),
};

const config = createChainForkConfig({...defaultChainConfig, ALTAIR_FORK_EPOCH: 1, BELLATRIX_FORK_EPOCH: 2});

const definitions = {
  ...routes.beacon.getDefinitions(config),
  ...routes.config.getDefinitions(config),
  ...routes.debug.getDefinitions(config),
  ...routes.events.getDefinitions(config),
  ...routes.lightclient.getDefinitions(config),
  ...routes.node.getDefinitions(config),
  ...routes.proof.getDefinitions(config),
  ...routes.validator.getDefinitions(config),
};

const testDatas = {
  ...beaconTestData,
  ...configTestData,
  ...debugTestData,
  ...eventsTestData,
  ...lightclientTestData,
  ...nodeTestData,
  ...proofsTestData,
  ...validatorTestData,
};

const ignoredOperations = [
  /* missing route */
  "getDepositSnapshot", // Won't fix for now, see https://github.com/ChainSafe/lodestar/issues/5697
  "getNextWithdrawals", // https://github.com/ChainSafe/lodestar/issues/5696
  /* Must support ssz response body */
  "getLightClientUpdatesByRange", // https://github.com/ChainSafe/lodestar/issues/6841
];

const ignoredProperties: Record<string, IgnoredProperty> = {
  /* 
   https://github.com/ChainSafe/lodestar/issues/6168
   /query/syncing_status - must be integer
   */
  getHealth: {request: ["query.syncing_status"]},

  /* 
   https://github.com/ChainSafe/lodestar/issues/4638 
   /query - must have required property 'skip_randao_verification'
   */
  produceBlockV2: {request: ["query.skip_randao_verification"]},
  produceBlindedBlock: {request: ["query.skip_randao_verification"]},
};

const openApiJson = await fetchOpenApiSpec(openApiFile);
runTestCheckAgainstSpec(openApiJson, definitions, testDatas, ignoredOperations, ignoredProperties);

const ignoredTopics = [
  /*
   https://github.com/ChainSafe/lodestar/issues/6470
   topic block_gossip not implemented
   */
  "block_gossip",
];

// eventstream types are defined as comments in the description of "examples".
// The function runTestCheckAgainstSpec() can't handle those, so the custom code before:
// - Parse example JSON from eventstream examples
// - Assert that our test data matches the JSON from examples
describe("eventstream event data", () => {
  // Additional test for eventstream events
  // "examples": {
  //   "head": {
  //     "description": "The node has finished processing, resulting in a new head. previous_duty_dependent_root is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch - 1) - 1)` and current_duty_dependent_root is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch) - 1)`. Both dependent roots use the genesis block root in the case of underflow.",
  //     "value": "event: head\ndata: {\"slot\":\"10\", \"block\":\"0x9a2fefd2fdb57f74993c7780ea5b9030d2897b615b89f808011ca5aebed54eaf\", \"state\":\"0x600e852a08c1200654ddf11025f1ceacb3c2e74bdd5c630cde0838b2591b69f9\", \"epoch_transition\":false, \"previous_duty_dependent_root\":\"0x5e0043f107cb57913498fbf2f99ff55e730bf1e151f02f221e977c91a90a0e91\", \"current_duty_dependent_root\":\"0x5e0043f107cb57913498fbf2f99ff55e730bf1e151f02f221e977c91a90a0e91\", \"execution_optimistic\": false}\n"
  //   }, ... }
  const eventstreamExamples =
    openApiJson.paths["/eth/v1/events"]["get"].responses["200"]?.content?.["text/event-stream"].examples;

  beforeAll(() => {
    if (!eventstreamExamples) {
      throw Error(`eventstreamExamples not defined: ${eventstreamExamples}`);
    }
  });

  const eventSerdes = routes.events.getEventSerdes(config);
  const knownTopics = new Set<string>(Object.values(routes.events.eventTypes));

  for (const [topic, {value}] of Object.entries(eventstreamExamples ?? {}).filter(
    ([topic]) => !ignoredTopics.includes(topic)
  )) {
    it(topic, () => {
      if (!knownTopics.has(topic)) {
        throw Error(`topic ${topic} not implemented`);
      }

      const exampleDataStr = value.split("\n").find((line) => line.startsWith("data:"));
      if (!exampleDataStr) {
        throw Error(`event example value must include 'data:' ${value}`);
      }

      const exampleDataJson = JSON.parse(exampleDataStr.slice(5).trim()) as unknown;

      const testEvent = eventTestData[topic as keyof typeof eventTestData];
      if (testEvent == null) {
        throw Error(`No eventTestData for ${topic}`);
      }
      const testEventJson = eventSerdes.toJson({
        type: topic as routes.events.EventType,
        message: testEvent,
      } as routes.events.BeaconEvent);

      expect(testEventJson).toEqual(exampleDataJson);
    });
  }
});

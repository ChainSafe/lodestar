import {SinonStubbedInstance} from "sinon";
import {config} from "@chainsafe/lodestar-config/mainnet";

import {ApiNamespace, RestApi} from "../../../../src/api";
import {StubbedApi} from "../../../utils/stub/api";
import {testLogger} from "../../../utils/logger";
import {DebugBeaconApi} from "../../../../src/api/impl/debug/beacon";
import {BeaconStateApi} from "../../../../src/api/impl/beacon/state";

export const BEACON_PREFIX = "/eth/v1/beacon";
export const CONFIG_PREFIX = "/eth/v1/config";
export const NODE_PREFIX = "/eth/v1/node";
export const VALIDATOR_PREFIX = "/eth/v1/validator";

beforeEach(async function () {
  this.api = new StubbedApi();
  this.restApi = await RestApi.init(
    {
      api: [
        ApiNamespace.BEACON,
        ApiNamespace.CONFIG,
        ApiNamespace.DEBUG,
        ApiNamespace.EVENTS,
        ApiNamespace.NODE,
        ApiNamespace.VALIDATOR,
      ],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0,
    },
    {
      config,
      logger: testLogger(),
      api: this.api,
    }
  );
  this.debugBeaconStub = this.api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
  this.beaconBlocksStub = this.api.beacon.blocks;
  this.configStub = this.api.config;
  this.beaconStub = this.api.beacon;
  this.beaconStateStub = this.api.beacon.state as SinonStubbedInstance<BeaconStateApi>;
  this.beaconPoolStub = this.api.beacon.pool;
  this.nodeStub = this.api.node;
  this.validatorStub = this.api.validator;
});

afterEach(async function () {
  await this.restApi.close();
});

describe("Test beacon rest api", function () {
  this.timeout(10000);
});

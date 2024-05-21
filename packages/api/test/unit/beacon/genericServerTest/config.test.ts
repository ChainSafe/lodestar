import {describe, it, expect} from "vitest";
import {config} from "@lodestar/config/default";
import {Endpoints, getDefinitions} from "../../../../src/beacon/routes/config.js";
import {getClient} from "../../../../src/beacon/client/config.js";
import {getRoutes} from "../../../../src/beacon/server/config.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/config.js";

describe("beacon / config", () => {
  runGenericServerTest<Endpoints>(config, getClient, getRoutes, testData);

  it("Serialize Partial Spec object", () => {
    const {getSpec} = getDefinitions(config);

    const partialJsonSpec: Record<string, string> = {
      PRESET_BASE: "mainnet",
      DEPOSIT_CONTRACT_ADDRESS: "0xff50ed3d0ec03ac01d4c79aad74928bff48a7b2b",
      GENESIS_FORK_VERSION: "0x00001020",
      TERMINAL_TOTAL_DIFFICULTY: "115792089237316195423570985008687907853269984665640564039457584007913129639936",
      MIN_GENESIS_TIME: "1606824000",
    };

    const jsonRes = getSpec.resp.data.toJson(partialJsonSpec);
    const specRes = getSpec.resp.data.fromJson(jsonRes);

    expect(specRes).toEqual(partialJsonSpec);
  });
});

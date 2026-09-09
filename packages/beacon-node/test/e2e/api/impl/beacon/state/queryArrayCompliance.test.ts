import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {ApiClient, getClient} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {LogLevel, testLogger} from "@lodestar/logger/test-utils";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {fetch} from "@lodestar/utils";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";

/**
 * beacon-API spec compliance: query-string arrays must accept at least the documented `maxItems`.
 *
 * Guards against regressions like https://github.com/ChainSafe/lodestar/issues/9672, where more than
 * 20 comma-separated validator `id` values were rejected with `id must be array` (400) because the
 * querystring `arrayLimit` was below the spec `maxItems`. The unit coverage in the sibling PR pins the
 * parser at the `RestApiServer` level; this suite exercises the full request path against a running node.
 *
 * Scope: an audit of every query-array param across the beacon-API surface shows only two carry more
 * than ~20 items in normal client usage, and both are validator-id queries covered here:
 *   - `getStateValidators` / `getStateValidatorBalances` `id` (maxItems=64)
 *   - `getDebugDataColumnSidecars` `indices` (maxItems=NUMBER_OF_COLUMNS)
 * All other query arrays (event `topics`, validator `status`, peer `state`/`direction`, blob `indices`,
 * `versioned_hashes`) are enum- or per-block-bounded well under the old default limit and never regressed.
 * The data-column `indices` path requires a Fulu block with columns to exercise end-to-end and is covered
 * at the unit level; it is a candidate for a follow-up here.
 */
describe("beacon-api query string array length compliance", () => {
  const restPort = 9601;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));
  // Must exceed the largest id we query (NUMBER_OF_COLUMNS) so every requested index is a real validator.
  const validatorCount = 512;
  const baseUrl = `http://127.0.0.1:${restPort}`;

  let bn: BeaconNode;
  let client: ApiClient["beacon"];

  beforeAll(async () => {
    bn = await getDevBeaconNode({
      params: chainConfigDef,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true},
        api: {rest: {enabled: true, port: restPort}},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      logger: testLogger("Node-A", {level: LogLevel.warn}),
    });
    client = getClient({baseUrl}, {config}).beacon;
  }, 60_000);

  afterAll(async () => {
    await bn.close();
  });

  // 64 is the beacon-API `maxItems` for validator id; NUMBER_OF_COLUMNS is the configured server cap.
  const itemCounts = [64, NUMBER_OF_COLUMNS];

  for (const n of itemCounts) {
    it(`getStateValidators accepts ${n} validator ids`, async () => {
      const validatorIds = Array.from({length: n}, (_, i) => i);
      const validators = (await client.getStateValidators({stateId: "head", validatorIds})).value();
      expect(validators, `getStateValidators should return ${n} validators for ${n} requested ids`).toHaveLength(n);
    });

    it(`getStateValidatorBalances accepts ${n} validator ids`, async () => {
      const validatorIds = Array.from({length: n}, (_, i) => i);
      const balances = (await client.getStateValidatorBalances({stateId: "head", validatorIds})).value();
      expect(balances, `getStateValidatorBalances should return ${n} balances for ${n} requested ids`).toHaveLength(n);
    });
  }

  // The @lodestar/api client serializes arrays as repeat-format (`id=a&id=b`); the original #9672 report
  // used comma-separated values (`id=a,b,c`). Exercise that exact wire form with a raw request.
  it("accepts 64 comma-separated validator ids (the #9672 wire form)", async () => {
    const ids = Array.from({length: 64}, (_, i) => i).join(",");
    const res = await fetch(`${baseUrl}/eth/v1/beacon/states/head/validators?id=${ids}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {data: unknown[]};
    expect(body.data).toHaveLength(64);
  });
});

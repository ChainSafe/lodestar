import {assert} from "chai";

import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0} from "@chainsafe/lodestar-types";
import {GENESIS_SLOT} from "../../../../src/constants";
import {getBlockRoot, getDomain} from "../../../../src/util";

import {toBigIntLE} from "bigint-buffer";

import {generateState} from "../../../utils/state";

describe("getDomain", () => {
  const testValues = [
    {
      domainValues: [4, 0, 0, 0],
      messageEpoch: 8,
      expected: "04000000d6e497b816c27a31acd5d9f3ed670639fef7842fee51f044dfbfb631",
    },
    {
      domainValues: [5, 0, 0, 0],
      messageEpoch: 13,
      expected: "05000000c8b9e6acb00f5b32f776f5466510630a94829c965d35074e9d162016",
    },
    {
      domainValues: [5, 0, 0, 0],
      messageEpoch: 12,
      expected: "05000000c8b9e6acb00f5b32f776f5466510630a94829c965d35074e9d162016",
    },
  ];

  for (const testValue of testValues) {
    it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
      const state = generateState();
      const fork: phase0.Fork = {
        epoch: 12,
        previousVersion: Buffer.from([4, 0, 0, 0]),
        currentVersion: Buffer.from([5, 0, 0, 0]),
      };
      state.fork = fork;
      const result = getDomain(config, state, Uint8Array.from(testValue.domainValues), testValue.messageEpoch);
      assert.equal(Buffer.from(result).toString("hex"), testValue.expected);
    });
  }
});

describe("getBlockRoot", () => {
  it("should return first block root for genesis slot", () => {
    const state = generateState({
      slot: GENESIS_SLOT + 1,
      blockRoots: Array.from({length: config.params.SLOTS_PER_HISTORICAL_ROOT}, () => Buffer.from([0xab])),
    });
    const res = Buffer.from(getBlockRoot(config, state, GENESIS_SLOT) as Uint8Array);
    const expectedRes = BigInt("0xab");
    assert(toBigIntLE(res) === expectedRes, `got: ${toBigIntLE(res)}, expected: ${expectedRes.toString(16)}`);
  });
  it("should fail if slot is current slot", () => {
    const state = generateState({slot: GENESIS_SLOT});
    assert.throws(() => getBlockRoot(config, state, GENESIS_SLOT), "");
  });
  it("should fail if slot is not within SLOTS_PER_HISTORICAL_ROOT of current slot", () => {
    const state = generateState({slot: GENESIS_SLOT + config.params.SLOTS_PER_HISTORICAL_ROOT + 1});
    assert.throws(() => getBlockRoot(config, state, GENESIS_SLOT), "");
  });
});

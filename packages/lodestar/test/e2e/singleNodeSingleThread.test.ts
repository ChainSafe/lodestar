import {IBeaconParams} from "@chainsafe/lodestar-params";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {getDevValidators} from "../utils/node/validator";
import { expect } from "chai";

describe("Run single node single thread interop validators (no eth1) until checkpoint", function () {
  const timeout = 120 * 1000;
  const testParams: Partial<IBeaconParams> = {
    SECONDS_PER_SLOT: 2,
    SLOTS_PER_EPOCH: 8
  };
  const manyValidatorParams: Partial<IBeaconParams> = {
    ...testParams,
    TARGET_AGGREGATORS_PER_COMMITTEE: 1
  };

  const testCases: {
    vc: number;
    validators: number;
    event: "justifiedCheckpoint" | "finalizedCheckpoint";
    params: Partial<IBeaconParams>;
  }[] = [
    {vc: 8, validators: 8, event: "justifiedCheckpoint", params: testParams},
    {vc: 8, validators: 8, event: "finalizedCheckpoint", params: testParams},
    {vc: 1, validators: 32, event: "justifiedCheckpoint", params: manyValidatorParams},
  ];

  for (const testCase of testCases) {
    it(`${testCase.vc} vc / ${testCase.validators} validator > until ${testCase.event}`, async function () {
      this.timeout(timeout);
      const bn = await getDevBeaconNode({
        params: testCase.params,
        options: {sync: {minPeers: 0}},
        validatorCount: testCase.vc * testCase.validators
      });
      const justificationEventListener = waitForEvent<Checkpoint>(bn.chain, testCase.event, timeout - 10 * 1000);
      const validators = getDevValidators(bn, testCase.validators, testCase.vc);
      await bn.start();
      await Promise.all(validators.map(v => v.start()));
      try {
        await justificationEventListener;
      } catch (e) {
        await Promise.all(validators.map((v) => v.stop()));
        await bn.stop();
        expect(`failed to get event: ${testCase.event}`);
      }
      await Promise.all(validators.map((v) => v.stop()));
      await bn.stop();
    });
  }
});

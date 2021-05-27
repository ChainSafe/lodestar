import sinon from "sinon";
import {AbortController} from "abort-controller";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ForkService} from "../../../src/services/fork";
import {getApiClientStub} from "../../utils/apiStub";
import {testLogger} from "../../utils/logger";
import {expect} from "chai";
import {ClockMock} from "../../utils/clock";

describe("ForkService", () => {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  const api = getApiClientStub(sandbox);

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Should only fetch the fork once", async () => {
    const clock = new ClockMock();
    const forkService = new ForkService(api, logger, clock);

    const fork = config.types.phase0.Fork.defaultValue();
    api.beacon.getStateFork.resolves({data: fork});

    // Trigger clock onSlot for slot 0
    // Don't resolve the promise immediatelly to check the promise caching mechanism
    void clock.tickEpochFns(0, controller.signal);

    // Call getStateFork() multiple times at once
    await Promise.all(
      Array.from({length: 3}).map(async () => {
        expect(await forkService.getFork()).to.equal(fork, "Wrong resolved value on forkService.getStateFork()");
      })
    );

    expect(api.beacon.getStateFork.callCount).to.equal(1, "getStateFork must only be called once");
  });
});

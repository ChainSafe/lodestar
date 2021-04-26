import sinon from "sinon";
import {AbortController} from "abort-controller";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ForkService} from "../../../src/services/fork";
import {ApiClientStub} from "../../utils/apiStub";
import {testLogger} from "../../utils/logger";
import {expect} from "chai";
import {ClockMock} from "../../utils/clock";

describe("ForkService", () => {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  const apiClient = ApiClientStub(sandbox);

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Should only fetch the fork once", async () => {
    const clock = new ClockMock();
    const forkService = new ForkService(apiClient, logger, clock);

    const fork = config.types.phase0.Fork.defaultValue();
    apiClient.beacon.state.getFork.resolves(fork);

    // Trigger clock onSlot for slot 0
    // Don't resolve the promise immediatelly to check the promise caching mechanism
    void clock.tickEpochFns(0, controller.signal);

    // Call getFork() multiple times at once
    await Promise.all(
      Array.from({length: 3}).map(async () => {
        expect(await forkService.getFork()).to.equal(fork, "Wrong resolved value on forkService.getFork()");
      })
    );

    expect(apiClient.beacon.state.getFork.callCount).to.equal(1, "getFork must only be called once");
  });
});

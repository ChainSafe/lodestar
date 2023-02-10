import {expect} from "chai";
import sinon from "sinon";
import {showProgress} from "../../../src/util/progress.js";

describe("progress", () => {
  const sandbox = sinon.createSandbox();

  describe("showProgress", () => {
    beforeEach(() => {
      sandbox.useFakeTimers();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it("should call progress with correct frequency", () => {
      const progress = sandbox.spy();
      const frequencyMs = 50;
      showProgress({total: 10, signal: new AbortController().signal, frequencyMs, progress});
      sandbox.clock.tick(frequencyMs * 4);

      expect(progress.callCount).to.be.equal(4);
    });

    it("should call progress with correct values", () => {
      const progress = sandbox.spy();
      const frequencyMs = 50;
      const total = 8;
      const needle = showProgress({total, signal: new AbortController().signal, frequencyMs, progress});
      needle(1);
      sandbox.clock.tick(frequencyMs);
      needle(3);
      sandbox.clock.tick(frequencyMs);

      expect(progress).to.be.calledTwice;
      expect(progress.firstCall.args[0]).to.eql({total, current: 2, ratePerSec: 40, percentage: 25});
      expect(progress.secondCall.args[0]).to.eql({total, current: 4, ratePerSec: 40, percentage: 50});
    });

    it("should call progress with correct values when reach total", () => {
      const progress = sandbox.spy();
      const frequencyMs = 50;
      const total = 8;
      const needle = showProgress({total, signal: new AbortController().signal, frequencyMs, progress});
      needle(1);
      sandbox.clock.tick(frequencyMs);
      needle(7);

      // Once by timer and second time because of reaching total
      expect(progress).to.be.calledTwice;
      // ratePerSec is 0 (actually Infinity) because we reached total without moving the clock time
      expect(progress.secondCall.args[0]).to.eql({total, current: total, ratePerSec: 0, percentage: 100});
    });

    it("should call progress with correct values directly reaches to total", () => {
      const progress = sandbox.spy();
      const frequencyMs = 50;
      const total = 8;
      const needle = showProgress({total, signal: new AbortController().signal, frequencyMs, progress});
      needle(7);

      expect(progress).to.be.calledOnce;
      expect(progress.firstCall.args[0]).to.eql({total, current: total, ratePerSec: 0, percentage: 100});
    });

    it("should not call progress when initiated with zero total", () => {
      const progress = sandbox.spy();
      const frequencyMs = 50;
      const total = 0;
      showProgress({total, signal: new AbortController().signal, frequencyMs, progress});

      expect(progress).to.be.not.be.called;
    });

    it("should not call progress further when abort signal is called", () => {
      const progress = sandbox.spy();
      const frequencyMs = 50;
      const controller = new AbortController();
      showProgress({total: 10, signal: controller.signal, frequencyMs, progress});
      sandbox.clock.tick(frequencyMs * 2);
      controller.abort();
      sandbox.clock.tick(frequencyMs * 2);

      expect(progress.callCount).to.be.equal(2);
    });

    it("should not call progress further when total is reached", () => {
      const progress = sandbox.spy();
      const frequencyMs = 50;
      const needle = showProgress({total: 10, signal: new AbortController().signal, frequencyMs, progress});
      sandbox.clock.tick(frequencyMs * 2);
      needle(50);
      sandbox.clock.tick(frequencyMs * 2);

      // 2 calls based on interval and 1 call based on reaching total
      expect(progress.callCount).to.be.equal(2 + 1);
    });
  });
});

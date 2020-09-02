import {AbortController} from "abort-controller";
import {expect} from "chai";
import {abortableTimeout} from "../../../src/util/misc";

describe("misc test", () => {
  it("should start and abort abortableTimeout", () => {
    const controller = new AbortController();
    const {signal} = controller;
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const timeout = setTimeout(() => {}, 3000);
    let cleared = false;
    abortableTimeout(signal, () => {
      clearTimeout(timeout);
      cleared = true;
    });
    controller.abort();
    expect(signal.aborted).to.be.true;
    expect(cleared).to.be.true;
  });
});

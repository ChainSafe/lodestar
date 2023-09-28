import "../setup.js";
import {expect} from "chai";
import sinon from "sinon";
import {waitFor, waitForElapsedTime} from "../../src/waitFor.js";
import {ErrorAborted, TimeoutError} from "../../src/errors.js";
import {sleep} from "../../src/sleep.js";

describe("waitFor", () => {
  const interval = 10;
  const timeout = 20;

  it("Should resolve if condition is already true", async () => {
    await expect(waitFor(() => true, {interval, timeout})).to.be.fulfilled;
  });

  it("Should resolve if condition becomes true within timeout", async () => {
    let condition = false;
    setTimeout(() => {
      condition = true;
    }, interval);
    await waitFor(() => condition, {interval, timeout});
  });

  it("Should reject with TimeoutError if condition does not become true within timeout", async () => {
    await expect(waitFor(() => false, {interval, timeout})).to.be.rejectedWith(TimeoutError);
  });

  it("Should reject with ErrorAborted if aborted before condition becomes true", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), interval);
    await expect(waitFor(() => false, {interval, timeout, signal: controller.signal})).to.be.rejectedWith(ErrorAborted);
  });

  it("Should reject with ErrorAborted if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitFor(() => true, {interval, timeout, signal: controller.signal})).to.be.rejectedWith(ErrorAborted);
  });
});

describe("waitForElapsedTime", () => {
  it("should call the function for the first time", () => {
    const callIfTimePassed = waitForElapsedTime({minElapsedTime: 1000});
    const fn = sinon.spy();
    callIfTimePassed(fn);

    expect(fn).to.have.been.calledOnce;
  });

  it("should call the function after the minElapsedTime has passed", async () => {
    const callIfTimePassed = waitForElapsedTime({minElapsedTime: 100});
    const fn = sinon.spy();
    callIfTimePassed(fn);

    await sleep(150);
    callIfTimePassed(fn);

    expect(fn).to.have.been.calledTwice;
  });

  it("should not call the function before the minElapsedTime has passed", () => {
    const callIfTimePassed = waitForElapsedTime({minElapsedTime: 100});
    const fn = sinon.spy();
    callIfTimePassed(fn);
    callIfTimePassed(fn);

    expect(fn).to.have.been.calledOnce;
  });

  it("should call the onError if the function is called before the minElapsedTime has passed", () => {
    const fn = sinon.spy();
    const err = sinon.spy();
    const callIfTimePassed = waitForElapsedTime({minElapsedTime: 100, onError: err});
    callIfTimePassed(fn);
    callIfTimePassed(fn);

    expect(err).to.have.been.calledOnce;
  });

  it("should not call the onError if the function is called after the minElapsedTime has passed", async () => {
    const fn = sinon.spy();
    const err = sinon.spy();
    const callIfTimePassed = waitForElapsedTime({minElapsedTime: 100, onError: err});
    callIfTimePassed(fn);

    await sleep(100);

    callIfTimePassed(fn);

    expect(err).to.have.been.callCount(0);
  });
});

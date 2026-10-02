import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {processExecutionPayload} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeProcessor} from "../../../../src/chain/blocks/payloadEnvelopeProcessor.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";

vi.mock("../../../../src/chain/blocks/importExecutionPayload.js");

describe("chain / blocks / PayloadEnvelopeProcessor", () => {
  let processor: PayloadEnvelopeProcessor;
  let abortController: AbortController;
  let payloadInput: PayloadEnvelopeInput;

  beforeEach(() => {
    abortController = new AbortController();
    processor = new PayloadEnvelopeProcessor({} as BeaconChain, null, abortController.signal);
    // processExecutionPayload is mocked, the input is only used as an identity key
    payloadInput = {} as PayloadEnvelopeInput;
  });

  afterEach(() => {
    abortController.abort();
    vi.resetAllMocks();
  });

  it("should run the import once for duplicate calls and resolve all callers on completion", async () => {
    let resolveImport: () => void = () => {};
    vi.mocked(processExecutionPayload).mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      })
    );

    let firstResolved = false;
    let secondResolved = false;
    const first = processor.processPayloadEnvelopeJob(payloadInput).then(() => {
      firstResolved = true;
    });
    const second = processor.processPayloadEnvelopeJob(payloadInput).then(() => {
      secondResolved = true;
    });

    // Duplicate calls must not resolve before the import completes, else callers like
    // BlockInputSync treat a still-pending payload as processed and re-queue it in a tight loop
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstResolved).toBe(false);
    expect(secondResolved).toBe(false);
    expect(processExecutionPayload).toHaveBeenCalledTimes(1);

    resolveImport();
    await Promise.all([first, second]);
    expect(firstResolved).toBe(true);
    expect(secondResolved).toBe(true);
    expect(processExecutionPayload).toHaveBeenCalledTimes(1);
  });

  it("should propagate import failure to deduped callers", async () => {
    let rejectImport: (e: Error) => void = () => {};
    vi.mocked(processExecutionPayload).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectImport = reject;
      })
    );

    const first = processor.processPayloadEnvelopeJob(payloadInput);
    const second = processor.processPayloadEnvelopeJob(payloadInput);

    rejectImport(new Error("IMPORT_FAILED"));
    await expect(first).rejects.toThrow("IMPORT_FAILED");
    await expect(second).rejects.toThrow("IMPORT_FAILED");
    expect(processExecutionPayload).toHaveBeenCalledTimes(1);
  });

  it("should retry the import after a failed attempt", async () => {
    vi.mocked(processExecutionPayload).mockRejectedValueOnce(new Error("IMPORT_FAILED"));
    vi.mocked(processExecutionPayload).mockResolvedValueOnce(undefined);

    await expect(processor.processPayloadEnvelopeJob(payloadInput)).rejects.toThrow("IMPORT_FAILED");

    await processor.processPayloadEnvelopeJob(payloadInput);
    expect(processExecutionPayload).toHaveBeenCalledTimes(2);
  });

  it("should not re-run the import after success", async () => {
    vi.mocked(processExecutionPayload).mockResolvedValue(undefined);

    await processor.processPayloadEnvelopeJob(payloadInput);
    await processor.processPayloadEnvelopeJob(payloadInput);
    expect(processExecutionPayload).toHaveBeenCalledTimes(1);
  });
});

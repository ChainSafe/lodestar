import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {importExecutionPayload} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeProcessor} from "../../../../src/chain/blocks/payloadEnvelopeProcessor.js";
import {verifyPayloadsDataAvailability} from "../../../../src/chain/blocks/verifyPayloadsDataAvailability.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";

vi.mock("../../../../src/chain/blocks/importExecutionPayload.js");
vi.mock("../../../../src/chain/blocks/verifyPayloadsDataAvailability.js");

function dataAvailable(status = DataAvailabilityStatus.Available): ReturnType<typeof verifyPayloadsDataAvailability> {
  return Promise.resolve({dataAvailabilityStatuses: [status], availableTime: 0});
}

describe("chain / blocks / PayloadEnvelopeProcessor", () => {
  let processor: PayloadEnvelopeProcessor;
  let abortController: AbortController;
  let payloadInput: PayloadEnvelopeInput;

  beforeEach(() => {
    abortController = new AbortController();
    processor = new PayloadEnvelopeProcessor({config: {}} as BeaconChain, null, abortController.signal);
    // importExecutionPayload and the DA wait are mocked, the input is only used as an identity key
    payloadInput = {} as PayloadEnvelopeInput;
    vi.mocked(verifyPayloadsDataAvailability).mockImplementation(() => dataAvailable());
  });

  afterEach(() => {
    abortController.abort();
    vi.resetAllMocks();
  });

  it("should run the import once for duplicate calls and resolve all callers on completion", async () => {
    let resolveImport: () => void = () => {};
    vi.mocked(importExecutionPayload).mockReturnValue(
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
    expect(importExecutionPayload).toHaveBeenCalledTimes(1);

    resolveImport();
    await Promise.all([first, second]);
    expect(firstResolved).toBe(true);
    expect(secondResolved).toBe(true);
    expect(importExecutionPayload).toHaveBeenCalledTimes(1);
  });

  it("should propagate import failure to deduped callers", async () => {
    let rejectImport: (e: Error) => void = () => {};
    vi.mocked(importExecutionPayload).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectImport = reject;
      })
    );

    const first = processor.processPayloadEnvelopeJob(payloadInput);
    const second = processor.processPayloadEnvelopeJob(payloadInput);

    await new Promise((resolve) => setTimeout(resolve, 0));
    rejectImport(new Error("IMPORT_FAILED"));
    await expect(first).rejects.toThrow("IMPORT_FAILED");
    await expect(second).rejects.toThrow("IMPORT_FAILED");
    expect(importExecutionPayload).toHaveBeenCalledTimes(1);
  });

  it("should retry the import after a failed attempt", async () => {
    vi.mocked(importExecutionPayload).mockRejectedValueOnce(new Error("IMPORT_FAILED"));
    vi.mocked(importExecutionPayload).mockResolvedValueOnce(undefined);

    await expect(processor.processPayloadEnvelopeJob(payloadInput)).rejects.toThrow("IMPORT_FAILED");

    await processor.processPayloadEnvelopeJob(payloadInput);
    expect(importExecutionPayload).toHaveBeenCalledTimes(2);
  });

  it("should not re-run the import after success", async () => {
    vi.mocked(importExecutionPayload).mockResolvedValue(undefined);

    await processor.processPayloadEnvelopeJob(payloadInput);
    await processor.processPayloadEnvelopeJob(payloadInput);
    expect(importExecutionPayload).toHaveBeenCalledTimes(1);
  });

  it("should pass the data availability status to the import", async () => {
    vi.mocked(verifyPayloadsDataAvailability).mockImplementation(() =>
      dataAvailable(DataAvailabilityStatus.NotRequired)
    );
    vi.mocked(importExecutionPayload).mockResolvedValue(undefined);

    await processor.processPayloadEnvelopeJob(payloadInput, {validSignature: true});
    expect(importExecutionPayload).toHaveBeenCalledWith(payloadInput, DataAvailabilityStatus.NotRequired, {
      validSignature: true,
    });
  });

  it("should not hold a later payload behind one still waiting for its data", async () => {
    const stuckInput = {} as PayloadEnvelopeInput;
    let resolveStuckData: () => void = () => {};
    vi.mocked(verifyPayloadsDataAvailability).mockImplementation((_config, [input]) => {
      if (input === stuckInput) {
        return new Promise((resolve) => {
          resolveStuckData = () =>
            resolve({dataAvailabilityStatuses: [DataAvailabilityStatus.Available], availableTime: 0});
        });
      }
      return dataAvailable();
    });
    vi.mocked(importExecutionPayload).mockResolvedValue(undefined);

    let stuckResolved = false;
    const stuck = processor.processPayloadEnvelopeJob(stuckInput).then(() => {
      stuckResolved = true;
    });

    await processor.processPayloadEnvelopeJob(payloadInput);
    expect(importExecutionPayload).toHaveBeenCalledTimes(1);
    expect(importExecutionPayload).toHaveBeenLastCalledWith(payloadInput, DataAvailabilityStatus.Available, {});
    expect(stuckResolved).toBe(false);

    resolveStuckData();
    await stuck;
    expect(importExecutionPayload).toHaveBeenCalledTimes(2);
    expect(importExecutionPayload).toHaveBeenLastCalledWith(stuckInput, DataAvailabilityStatus.Available, {});
  });

  it("should surface a data availability failure without running the import", async () => {
    vi.mocked(verifyPayloadsDataAvailability).mockRejectedValueOnce(new Error("DATA_UNAVAILABLE"));
    vi.mocked(importExecutionPayload).mockResolvedValue(undefined);

    await expect(processor.processPayloadEnvelopeJob(payloadInput)).rejects.toThrow("DATA_UNAVAILABLE");
    expect(importExecutionPayload).not.toHaveBeenCalled();

    await processor.processPayloadEnvelopeJob(payloadInput);
    expect(importExecutionPayload).toHaveBeenCalledTimes(1);
  });
});

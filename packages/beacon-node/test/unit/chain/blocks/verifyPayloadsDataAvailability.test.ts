import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ColumnIndex, SignedBeaconBlock, gloas, ssz} from "@lodestar/types";
import {TimeoutError, toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {verifyPayloadsDataAvailability} from "../../../../src/chain/blocks/verifyPayloadsDataAvailability.js";

const config = createChainForkConfig({SLOT_DURATION_MS: 12_000, SLOT_DURATION_MS_HEZE: 10_000});

function buildPayloadEnvelopeInput({
  blobCount,
  sampledColumns,
  daOutOfRange = false,
  forkName = ForkName.gloas,
}: {
  blobCount: number;
  sampledColumns: ColumnIndex[];
  daOutOfRange?: boolean;
  forkName?: ForkName;
}): {
  payloadInput: PayloadEnvelopeInput;
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope;
} {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = 0;
  const commitments = Array.from({length: blobCount}, () => Buffer.alloc(48, 0x77));
  block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = commitments;

  const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toRootHex(blockRoot);

  const payloadInput = PayloadEnvelopeInput.createFromBlock({
    blockRootHex,
    block: block as SignedBeaconBlock<typeof ForkName.gloas>,
    forkName,
    sampledColumns,
    custodyColumns: sampledColumns,
    seenTimestampSec: Date.now() / 1000,
    source: PayloadEnvelopeInputSource.byRange,
    daOutOfRange,
  });

  const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  signedEnvelope.message.beaconBlockRoot = blockRoot;

  payloadInput.addPayloadEnvelope({
    envelope: signedEnvelope,
    source: PayloadEnvelopeInputSource.gossip,
    seenTimestampSec: Date.now() / 1000,
  });

  return {payloadInput, signedEnvelope};
}

function buildColumnSidecar(index: ColumnIndex): gloas.DataColumnSidecar {
  const columnSidecar = ssz.gloas.DataColumnSidecar.defaultValue();
  columnSidecar.index = index;
  return columnSidecar;
}

describe("verifyPayloadsDataAvailability", () => {
  it("resolves immediately when payload has no blobs (NotRequired)", async () => {
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 0, sampledColumns: [0, 1, 2, 3]});

    const controller = new AbortController();
    const {dataAvailabilityStatuses, availableTime} = await verifyPayloadsDataAvailability(
      config,
      [payloadInput],
      controller.signal
    );

    expect(dataAvailabilityStatuses).toEqual([DataAvailabilityStatus.NotRequired]);
    expect(availableTime).toBeGreaterThan(0);
  });

  it("resolves immediately when all sampled columns are already present", async () => {
    const sampled = [0, 1, 2, 3];
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 1, sampledColumns: sampled});
    for (const idx of sampled) {
      payloadInput.addColumn({
        columnSidecar: buildColumnSidecar(idx),
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
    }
    expect(payloadInput.hasAllData()).toBe(true);

    const controller = new AbortController();
    const {dataAvailabilityStatuses} = await verifyPayloadsDataAvailability(config, [payloadInput], controller.signal);
    expect(dataAvailabilityStatuses).toEqual([DataAvailabilityStatus.Available]);
  });

  it("waits for columns to arrive after envelope, then resolves", async () => {
    const sampled = [0, 1];
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 1, sampledColumns: sampled});
    expect(payloadInput.hasAllData()).toBe(false);

    const controller = new AbortController();
    const verifyPromise = verifyPayloadsDataAvailability(config, [payloadInput], controller.signal);

    // Columns arrive asynchronously
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const idx of sampled) {
      payloadInput.addColumn({
        columnSidecar: buildColumnSidecar(idx),
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
    }

    const {dataAvailabilityStatuses} = await verifyPromise;
    expect(dataAvailabilityStatuses).toEqual([DataAvailabilityStatus.Available]);
  });

  it("resolves when reconstruction threshold (>= NUMBER_OF_COLUMNS/2) is hit without any sampled column", async () => {
    const sampled = [0, 1, 2, 3];
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 1, sampledColumns: sampled});

    // Add NUMBER_OF_COLUMNS/2 non-sampled columns — none match sampled, but reconstruction is guaranteed
    for (let i = 10; i < 10 + NUMBER_OF_COLUMNS / 2; i++) {
      payloadInput.addColumn({
        columnSidecar: buildColumnSidecar(i),
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
    }

    expect(payloadInput.hasAllData()).toBe(true);
    expect(payloadInput.hasComputedAllData()).toBe(false);

    const controller = new AbortController();
    const {dataAvailabilityStatuses} = await verifyPayloadsDataAvailability(config, [payloadInput], controller.signal);
    expect(dataAvailabilityStatuses).toEqual([DataAvailabilityStatus.Available]);
  });

  describe("rejects after one slot of the payload's fork when columns never arrive", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    for (const [forkName, slotDurationMs] of [
      [ForkName.gloas, 12_000],
      [ForkName.heze, 10_000],
    ] as const) {
      it(`${forkName} ${slotDurationMs}ms`, async () => {
        const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 1, sampledColumns: [0, 1], forkName});
        expect(payloadInput.hasAllData()).toBe(false);

        let outcome: unknown;
        const verifyPromise = verifyPayloadsDataAvailability(config, [payloadInput], new AbortController().signal).then(
          () => {
            outcome = "resolved";
          },
          (e) => {
            outcome = e;
          }
        );

        await vi.advanceTimersByTimeAsync(slotDurationMs - 1);
        expect(outcome).toBeUndefined();

        await vi.advanceTimersByTimeAsync(1);
        await verifyPromise;
        expect(outcome).toBeInstanceOf(TimeoutError);
      });
    }
  });

  it("rejects promptly when signal is aborted", async () => {
    const sampled = [0, 1];
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 1, sampledColumns: sampled});
    expect(payloadInput.hasAllData()).toBe(false);

    const controller = new AbortController();
    const waitPromise = payloadInput.waitForAllData(60_000, controller.signal);
    controller.abort();
    await expect(waitPromise).rejects.toThrow();
  });

  it("emits OutOfRange when daOutOfRange=true and skips waiting for columns", async () => {
    const sampled = [0, 1];
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 1, sampledColumns: sampled, daOutOfRange: true});

    // Even with blobs declared and no columns delivered, hasAllData should be true at construction
    expect(payloadInput.hasAllData()).toBe(true);

    const controller = new AbortController();
    const {dataAvailabilityStatuses} = await verifyPayloadsDataAvailability(config, [payloadInput], controller.signal);
    expect(dataAvailabilityStatuses).toEqual([DataAvailabilityStatus.OutOfRange]);
  });
});

describe("PayloadEnvelopeInput.waitForEnvelopeAndAllData", () => {
  function buildPayloadInputNoEnvelope({
    blobCount,
    sampledColumns,
  }: {
    blobCount: number;
    sampledColumns: ColumnIndex[];
  }): {payloadInput: PayloadEnvelopeInput; signedEnvelope: gloas.SignedExecutionPayloadEnvelope} {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 0;
    const commitments = Array.from({length: blobCount}, () => Buffer.alloc(48, 0x77));
    block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = commitments;

    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toRootHex(blockRoot);

    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      blockRootHex,
      block: block as SignedBeaconBlock<typeof ForkName.gloas>,
      forkName: ForkName.gloas,
      sampledColumns,
      custodyColumns: sampledColumns,
      seenTimestampSec: Date.now() / 1000,
      source: PayloadEnvelopeInputSource.byRange,
      daOutOfRange: false,
    });

    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message.beaconBlockRoot = blockRoot;

    return {payloadInput, signedEnvelope};
  }

  it("resolves immediately when already complete", async () => {
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 0, sampledColumns: [0, 1, 2, 3]});
    expect(payloadInput.isComplete()).toBe(true);

    await expect(payloadInput.waitForEnvelopeAndAllData(60_000)).resolves.toBe(payloadInput);
  });

  it("waits for envelope and columns, then resolves", async () => {
    const sampled = [0, 1];
    const {payloadInput, signedEnvelope} = buildPayloadInputNoEnvelope({blobCount: 1, sampledColumns: sampled});
    expect(payloadInput.isComplete()).toBe(false);

    const controller = new AbortController();
    const waitPromise = payloadInput.waitForEnvelopeAndAllData(60_000, controller.signal);

    // Envelope + columns arrive asynchronously
    await new Promise((resolve) => setTimeout(resolve, 5));
    payloadInput.addPayloadEnvelope({
      envelope: signedEnvelope,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: Date.now() / 1000,
    });
    for (const idx of sampled) {
      payloadInput.addColumn({
        columnSidecar: buildColumnSidecar(idx),
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
    }

    await expect(waitPromise).resolves.toBe(payloadInput);
    expect(payloadInput.isComplete()).toBe(true);
  });

  it("rejects with timeout when envelope never arrives", async () => {
    const sampled = [0, 1];
    const {payloadInput} = buildPayloadInputNoEnvelope({blobCount: 1, sampledColumns: sampled});
    // Columns complete, but no envelope
    for (const idx of sampled) {
      payloadInput.addColumn({
        columnSidecar: buildColumnSidecar(idx),
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
    }
    expect(payloadInput.hasAllData()).toBe(true);
    expect(payloadInput.isComplete()).toBe(false);

    await expect(payloadInput.waitForEnvelopeAndAllData(10)).rejects.toThrow();
  });

  it("rejects with timeout when columns never arrive", async () => {
    const sampled = [0, 1];
    const {payloadInput, signedEnvelope} = buildPayloadInputNoEnvelope({blobCount: 1, sampledColumns: sampled});
    payloadInput.addPayloadEnvelope({
      envelope: signedEnvelope,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: Date.now() / 1000,
    });
    expect(payloadInput.hasAllData()).toBe(false);
    expect(payloadInput.isComplete()).toBe(false);

    await expect(payloadInput.waitForEnvelopeAndAllData(10)).rejects.toThrow();
  });

  it("rejects promptly when signal is aborted", async () => {
    const sampled = [0, 1];
    const {payloadInput} = buildPayloadInputNoEnvelope({blobCount: 1, sampledColumns: sampled});

    const controller = new AbortController();
    const waitPromise = payloadInput.waitForEnvelopeAndAllData(60_000, controller.signal);
    controller.abort();
    await expect(waitPromise).rejects.toThrow();
  });
});

describe("PayloadEnvelopeInput.waitForAllData", () => {
  it("resolves on reconstruction threshold without resolving waitForComputedAllData", async () => {
    const sampled = [0, 1, 2, 3];
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 1, sampledColumns: sampled});

    let allDataResolved = false;
    let computedAllDataResolved = false;
    const controller = new AbortController();
    payloadInput.waitForAllData(60_000, controller.signal).then(
      () => {
        allDataResolved = true;
      },
      () => {
        /* ignore abort */
      }
    );
    payloadInput.waitForComputedAllData(60_000, controller.signal).then(
      () => {
        computedAllDataResolved = true;
      },
      () => {
        /* ignore abort */
      }
    );

    for (let i = 10; i < 10 + NUMBER_OF_COLUMNS / 2; i++) {
      payloadInput.addColumn({
        columnSidecar: buildColumnSidecar(i),
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(allDataResolved).toBe(true);
    expect(computedAllDataResolved).toBe(false);

    controller.abort();
    // Let the aborted computedAllData promise settle before the test exits
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
});

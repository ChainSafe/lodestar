import {describe, expect, it} from "vitest";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ColumnIndex, SignedBeaconBlock, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {
  PAYLOAD_DATA_AVAILABILITY_TIMEOUT,
  verifyPayloadsDataAvailability,
} from "../../../../src/chain/blocks/verifyPayloadsDataAvailability.js";

function buildPayloadEnvelopeInput({
  blobCount,
  sampledColumns,
  daOutOfRange = false,
}: {
  blobCount: number;
  sampledColumns: ColumnIndex[];
  daOutOfRange?: boolean;
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
    forkName: ForkName.gloas,
    sampledColumns,
    custodyColumns: sampledColumns,
    timeCreatedSec: Date.now() / 1000,
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
    const {dataAvailabilityStatuses} = await verifyPayloadsDataAvailability([payloadInput], controller.signal);
    expect(dataAvailabilityStatuses).toEqual([DataAvailabilityStatus.Available]);
  });

  it("waits for columns to arrive after envelope, then resolves", async () => {
    const sampled = [0, 1];
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 1, sampledColumns: sampled});
    expect(payloadInput.hasAllData()).toBe(false);

    const controller = new AbortController();
    const verifyPromise = verifyPayloadsDataAvailability([payloadInput], controller.signal);

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
    const {dataAvailabilityStatuses} = await verifyPayloadsDataAvailability([payloadInput], controller.signal);
    expect(dataAvailabilityStatuses).toEqual([DataAvailabilityStatus.Available]);
  });

  it("rejects with timeout when columns never arrive", async () => {
    const sampled = [0, 1];
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 1, sampledColumns: sampled});
    expect(payloadInput.hasAllData()).toBe(false);

    // Temporarily shorten the timeout by monkey-patching? Better: run with natural timeout but bound the test.
    // Instead, call waitForAllData directly with a short timeout to verify the timeout behavior
    // (the helper uses PAYLOAD_DATA_AVAILABILITY_TIMEOUT which is too long for a unit test).
    const controller = new AbortController();
    await expect(payloadInput.waitForAllData(10, controller.signal)).rejects.toThrow();
    // Sanity: the helper constant is defined and positive.
    expect(PAYLOAD_DATA_AVAILABILITY_TIMEOUT).toBeGreaterThan(0);
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
    const {dataAvailabilityStatuses} = await verifyPayloadsDataAvailability([payloadInput], controller.signal);
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
      timeCreatedSec: Date.now() / 1000,
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

describe("PayloadEnvelopeInput partial columns", () => {
  it("builds a partial sidecar from accumulated cells and from the completed column", () => {
    const {payloadInput} = buildPayloadEnvelopeInput({blobCount: 2, sampledColumns: [0]});
    const columnIndex = 0;
    const firstCell = new Uint8Array([1]);
    const secondCell = new Uint8Array([2]);
    const firstProof = new Uint8Array([3]);
    const secondProof = new Uint8Array([4]);

    const incompleteColumn = payloadInput.addCells(
      columnIndex,
      [true, false],
      [firstCell],
      [firstProof],
      PayloadEnvelopeInputSource.gossip,
      Date.now() / 1000,
      "peer-a"
    );
    expect(incompleteColumn).toBeNull();

    const accumulatedPartial = payloadInput.getPartialColumnSidecar(columnIndex);
    expect(accumulatedPartial?.cellsPresentBitmap.toBoolArray()).toEqual([true, false]);
    expect(accumulatedPartial?.partialColumn).toEqual([firstCell]);
    expect(accumulatedPartial?.kzgProofs).toEqual([firstProof]);

    const completedColumn = payloadInput.addCells(
      columnIndex,
      [false, true],
      [secondCell],
      [secondProof],
      PayloadEnvelopeInputSource.gossip,
      Date.now() / 1000,
      "peer-b"
    );
    expect(completedColumn).not.toBeNull();

    const completedPartial = payloadInput.getPartialColumnSidecar(columnIndex);
    expect(completedPartial?.cellsPresentBitmap.toBoolArray()).toEqual([true, true]);
    expect(completedPartial?.partialColumn).toEqual([firstCell, secondCell]);
    expect(completedPartial?.kzgProofs).toEqual([firstProof, secondProof]);
  });
});

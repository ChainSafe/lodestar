import {describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngineMode} from "../../../../src/chain/beaconEngine/options.js";
import {payloadFailureFromError} from "../../../../src/chain/beaconEngine/processingResult.js";
import {PayloadImportError, importExecutionPayload} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {PayloadError, PayloadErrorCode} from "../../../../src/chain/blocks/payloadError.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";

const engineModes = [BeaconEngineMode.MainThread, BeaconEngineMode.Worker];

describe("payload import error context", () => {
  it.each(engineModes)("attaches the facade input to a payload error (worker: %s)", async (beaconEngineMode) => {
    const chain = getMockedBeaconChain();
    chain.opts.beaconEngineMode = beaconEngineMode;
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex: toRootHex(blockRoot),
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.byRange,
      seenTimestampSec: 0,
    });
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = blockRoot;
    envelope.message.payload.slotNumber = 1;
    payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 0});
    Object.defineProperty(chain, "unfinalizedPayloadEnvelopeWrites", {
      value: {waitForSpace: vi.fn().mockResolvedValue(undefined), push: vi.fn()},
    });
    const error = new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
    const importPayload = vi.fn().mockResolvedValue(structuredClone({err: payloadFailureFromError(error)}));
    chain.beaconEngine.importExecutionPayloadBytes = importPayload;
    chain.beaconEngine.importExecutionPayload = importPayload;
    chain.executionEngine.notifyNewPayload = vi.fn<typeof chain.executionEngine.notifyNewPayload>().mockResolvedValue({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: toRootHex(new Uint8Array(32)),
      validationError: null,
    });

    const importing = importExecutionPayload.call(
      withBeaconEngineFacade(chain),
      payloadInput,
      DataAvailabilityStatus.Available
    );
    await expect(importing).rejects.toBeInstanceOf(PayloadImportError);
    await expect(importing).rejects.toBeInstanceOf(PayloadError);
    await importing.catch((error: PayloadImportError) => expect(error.payloadInput).toBe(payloadInput));
    await expect(importing).rejects.toMatchObject({
      payloadInput,
      type: error.type,
      message: error.message,
      stack: error.stack,
    });
    expect("payloadInput" in error).toBe(false);
    const bytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
    expect(importPayload).toHaveBeenCalledExactlyOnceWith(
      beaconEngineMode !== BeaconEngineMode.MainThread ? bytes : {data: envelope, bytes},
      DataAvailabilityStatus.Available,
      {validSignature: false, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 0}
    );
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
    expect(chain.unfinalizedPayloadEnvelopeWrites.push).not.toHaveBeenCalled();
  });
});

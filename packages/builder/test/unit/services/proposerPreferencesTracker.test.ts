import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import type {RootHex} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";
import {getMockedLogger} from "../utils/logger.js";

describe("ProposerPreferencesTracker", () => {
  const api = getApiClientStub();
  const logger = getMockedLogger();

  beforeEach(() => {
    vi.resetAllMocks();
    api.events.eventstream.mockResolvedValue(mockApiResponse({data: undefined, meta: undefined}));
  });

  it("returns preferences only for the exact slot and dependent root", () => {
    const tracker = new ProposerPreferencesTracker(api, logger);
    const signed = preferences(4, 1, 2);

    expect(tracker.onProposerPreferences(signed)).toBe(true);
    expect(tracker.get(4, root(1))).toEqual(signed);
    expect(tracker.get(4, root(1))).toBe(signed);
    expect(tracker.get(5, root(1))).toBeNull();
    expect(tracker.get(4, root(2))).toBeNull();
  });

  it("retains separate branch preferences for one proposal slot", () => {
    const tracker = new ProposerPreferencesTracker(api, logger);
    const first = preferences(4, 1, 2);
    const second = preferences(4, 2, 3);

    tracker.onProposerPreferences(first);
    tracker.onProposerPreferences(second);

    expect(tracker.get(4, root(1))).toEqual(first);
    expect(tracker.get(4, root(2))).toEqual(second);
  });

  it("preserves the first validated preferences for a duplicate identity", () => {
    const tracker = new ProposerPreferencesTracker(api, logger);
    const first = preferences(4, 1, 2);
    const duplicate = preferences(4, 1, 3);

    expect(tracker.onProposerPreferences(first)).toBe(true);
    expect(tracker.onProposerPreferences(duplicate)).toBe(false);
    expect(tracker.get(4, root(1))).toEqual(first);
  });

  it("prunes past proposal slots while retaining current and future preferences", () => {
    const tracker = new ProposerPreferencesTracker(api, logger);
    tracker.onProposerPreferences(preferences(3, 1, 2));
    tracker.onProposerPreferences(preferences(4, 2, 3));
    tracker.onProposerPreferences(preferences(5, 3, 4));

    expect(tracker.prune(4)).toBe(1);
    expect(tracker.get(3, root(1))).toBeNull();
    expect(tracker.get(4, root(2))).not.toBeNull();
    expect(tracker.get(5, root(3))).not.toBeNull();
    expect(tracker.prune(4)).toBe(0);
  });

  it.each([ForkName.gloas, ForkName.heze])("tracks %s preferences from the event stream", (version) => {
    const tracker = new ProposerPreferencesTracker(api, logger);
    const controller = new AbortController();
    tracker.start(controller.signal);

    expect(api.events.eventstream).toHaveBeenCalledExactlyOnceWith({
      topics: [routes.events.EventType.proposerPreferences],
      signal: controller.signal,
      onEvent: expect.any(Function),
      onError: expect.any(Function),
      onClose: expect.any(Function),
    });
    const {onEvent} = api.events.eventstream.mock.calls[0][0];
    const signed = preferences(4, 1, 2);
    onEvent({type: routes.events.EventType.proposerPreferences, message: {version, data: signed}});
    onEvent({
      type: routes.events.EventType.proposerPreferences,
      message: {version, data: preferences(4, 1, 3)},
    });
    expect(tracker.get(4, root(1))).toEqual(signed);
  });

  it("ignores other event topics", () => {
    const tracker = new ProposerPreferencesTracker(api, logger);
    tracker.start(new AbortController().signal);
    api.events.eventstream.mock.calls[0][0].onEvent({
      type: routes.events.EventType.blockGossip,
      message: {slot: 4, block: root(1)},
    });
    expect(tracker.get(4, root(1))).toBeNull();
  });

  it("does not subscribe with an already aborted signal", () => {
    const tracker = new ProposerPreferencesTracker(api, logger);
    tracker.start(AbortSignal.abort());
    expect(api.events.eventstream).not.toHaveBeenCalled();
  });

  it("ignores events delivered after shutdown", () => {
    const tracker = new ProposerPreferencesTracker(api, logger);
    const controller = new AbortController();
    tracker.start(controller.signal);
    controller.abort();
    api.events.eventstream.mock.calls[0][0].onEvent({
      type: routes.events.EventType.proposerPreferences,
      message: {version: ForkName.gloas, data: preferences(4, 1, 2)},
    });
    expect(tracker.get(4, root(1))).toBeNull();
  });

  it("logs subscription rejection without an unhandled rejection", async () => {
    const error = Error("Connection refused");
    api.events.eventstream.mockRejectedValue(error);
    const tracker = new ProposerPreferencesTracker(api, logger);
    tracker.start(new AbortController().signal);

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith("Failed to subscribe to proposer preferences", {}, error);
    });
  });

  it("distinguishes an unexpected stream close from shutdown", () => {
    const tracker = new ProposerPreferencesTracker(api, logger);
    const controller = new AbortController();
    tracker.start(controller.signal);
    const {onClose, onError} = api.events.eventstream.mock.calls[0][0];
    const error = Error("Connection interrupted");
    onError?.(error);
    expect(logger.error).toHaveBeenCalledWith("Failed to receive proposer preferences", {}, error);
    onClose?.();
    expect(logger.error).toHaveBeenCalledWith("Proposer preferences stream closed unexpectedly", {});

    vi.mocked(logger.error).mockClear();
    controller.abort();
    onClose?.();
    onError?.(error);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

function preferences(
  proposalSlot: number,
  dependentRootByte: number,
  feeRecipientByte: number
): ReturnType<typeof ssz.gloas.SignedProposerPreferences.defaultValue> {
  const signed = ssz.gloas.SignedProposerPreferences.defaultValue();
  signed.message.proposalSlot = proposalSlot;
  signed.message.dependentRoot = Uint8Array.from({length: 32}, () => dependentRootByte);
  signed.message.feeRecipient = Uint8Array.from({length: 20}, () => feeRecipientByte);
  return signed;
}

function root(byte: number): RootHex {
  return toRootHex(Uint8Array.from({length: 32}, () => byte));
}

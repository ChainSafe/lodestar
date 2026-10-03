import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {ErrorAborted, defer} from "@lodestar/utils";
import {getClient} from "../../../src/beacon/client/events.js";
import {EventType} from "../../../src/beacon/routes/events.js";
import {getEventSource} from "../../../src/utils/client/eventSource.js";

vi.mock("../../../src/utils/client/eventSource.js");

describe("event stream cancellation", () => {
  const close = vi.fn();
  const addEventListener = vi.fn();
  const EventSourceMock = vi.fn(
    class {
      close = close;
      addEventListener = addEventListener;
    }
  );
  const EventSourceConstructor = EventSourceMock as unknown as typeof EventSource;
  const client = getClient(config, "http://127.0.0.1:9596");
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
    vi.mocked(getEventSource).mockResolvedValue(EventSourceConstructor);
  });

  afterEach(() => {
    controller.abort();
    vi.resetAllMocks();
  });

  it("does not create a connection with an already aborted signal", async () => {
    controller.abort();

    await expect(
      client.eventstream({topics: [EventType.block], signal: controller.signal, onEvent: vi.fn()})
    ).rejects.toBeInstanceOf(ErrorAborted);

    expect(EventSourceMock).not.toHaveBeenCalled();
  });

  it("does not create a connection if aborted while loading EventSource", async () => {
    const loaded = defer<typeof EventSource>();
    vi.mocked(getEventSource).mockReturnValue(loaded.promise);
    const setup = client.eventstream({topics: [EventType.block], signal: controller.signal, onEvent: vi.fn()});
    const rejected = expect(setup).rejects.toBeInstanceOf(ErrorAborted);

    expect(getEventSource).toHaveBeenCalledOnce();
    controller.abort();
    loaded.resolve(EventSourceConstructor);
    await rejected;

    expect(EventSourceMock).not.toHaveBeenCalled();
  });

  it("closes an established multi-topic subscription once on abort", async () => {
    const onClose = vi.fn();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    await client.eventstream({
      topics: [EventType.block, EventType.proposerPreferences],
      signal: controller.signal,
      onEvent: vi.fn(),
      onClose,
    });

    expect(EventSourceMock).toHaveBeenCalledOnce();
    expect(addEventListener).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
    controller.abort();
    controller.abort();

    expect(close).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

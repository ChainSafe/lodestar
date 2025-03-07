import {Logger} from "@lodestar/logger";
import {Checkpoint} from "@lodestar/types/phase0";
import {sleep} from "@lodestar/utils";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {ChainEvent, ChainEventEmitter} from "../../../src/chain/emitter.js";
import {ChainObserver, QueueObserver} from "../../../src/chain/observer.js";
import {JobItemQueue} from "../../../src/util/queue/itemQueue.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";

class CustomObserver extends ChainObserver {
  onCheckpoint(_checkpoint: Checkpoint) {}
}

class CustomQueueObserver extends QueueObserver {
  onCheckpoint(_checkpoint: Checkpoint) {}
}

describe("observers", () => {
  describe("ChainObserver", () => {
    let emitter: ChainEventEmitter;
    let observer: CustomObserver;
    let logger: Logger;

    beforeEach(() => {
      logger = getMockedLogger();
      emitter = new ChainEventEmitter();
      observer = new CustomObserver({logger});
      vi.spyOn(observer, "onCheckpoint").mockResolvedValue();
    });

    it("should subscribe to events", () => {
      observer.subscribe(emitter);

      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(1);
    });

    it("should call right handler on event emit", () => {
      const checkpoint = {} as Checkpoint;
      observer.subscribe(emitter);
      emitter.emit(ChainEvent.checkpoint, checkpoint);

      expect(observer.onCheckpoint).toHaveBeenCalledWith(checkpoint);
      expect(observer.onCheckpoint).toHaveBeenCalledOnce();
    });

    it("should cleanup all handlers on unsubscribe", () => {
      observer.subscribe(emitter);
      observer.unsubscribe();

      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(0);
    });

    it("should cleanup all handlers on abort", () => {
      const controller = new AbortController();
      observer.subscribe(emitter, controller.signal);

      controller.abort();

      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(0);
    });
  });

  describe("QueueObserver", () => {
    let emitter: ChainEventEmitter;
    let observer: CustomQueueObserver;
    let logger: Logger;
    let controller: AbortController;

    beforeEach(() => {
      controller = new AbortController();
      logger = getMockedLogger();
      emitter = new ChainEventEmitter();
      observer = new CustomQueueObserver({logger, maxQueueLength: 10, signal: controller.signal});
      vi.spyOn(observer, "onCheckpoint").mockResolvedValue();
    });

    it("should subscribe to events", () => {
      observer.subscribe(emitter);

      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(1);
    });

    it("should create a queue if maxQueueLength is given", () => {
      expect(observer["jobQueue"]).toBeInstanceOf(JobItemQueue);
      expect(observer["jobQueue"]["opts"].maxLength).toBe(10);
    });

    it("should use queue if queue is given", () => {
      expect(observer["jobQueue"]).toBeInstanceOf(JobItemQueue);
      expect(observer["jobQueue"]["opts"].maxLength).toBe(10);
    });

    it("should call right handler on event emit", async () => {
      const checkpoint = {} as Checkpoint;
      observer.subscribe(emitter);
      emitter.emit(ChainEvent.checkpoint, checkpoint);

      // As the event are triggered in a queue so need to give some time
      await sleep(50);

      expect(observer.onCheckpoint).toHaveBeenCalledWith(checkpoint);
      expect(observer.onCheckpoint).toHaveBeenCalledOnce();
    });

    it("should call handler in sequence", async () => {
      const checkpoint1 = {message: "checkpoint-1"} as unknown as Checkpoint;
      const checkpoint2 = {message: "checkpoint-1"} as unknown as Checkpoint;

      // Make sure each call take some time, so we can test these run in a sequence
      vi.spyOn(observer, "onCheckpoint").mockImplementation(async () => {
        await sleep(50);
      });

      observer.subscribe(emitter);
      emitter.emit(ChainEvent.checkpoint, checkpoint1);
      emitter.emit(ChainEvent.checkpoint, checkpoint2);

      // As the event are triggered in a queue so need to give some time
      await sleep(150);

      expect(observer.onCheckpoint).toHaveBeenCalledTimes(2);
      expect(observer.onCheckpoint).toHaveBeenNthCalledWith(1, checkpoint1);
      expect(observer.onCheckpoint).toHaveBeenNthCalledWith(2, checkpoint2);
    });

    it("should cleanup all handlers on unsubscribe", () => {
      observer.subscribe(emitter);
      observer.unsubscribe();

      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(0);
    });

    it("should cleanup all handlers on abort", () => {
      const controller = new AbortController();
      observer.subscribe(emitter, controller.signal);

      controller.abort();

      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(0);
    });
  });
});

import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/logger";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Checkpoint} from "@lodestar/types/phase0";
import {sleep} from "@lodestar/utils";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {ChainEvent, ChainEventEmitter} from "../../../src/chain/emitter.js";
import {BaseObserver, ChainObserver, MediatorQueueObserver, QueueObserver} from "../../../src/chain/observer.js";
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
      emitter.emit(ChainEvent.checkpoint, checkpoint, {} as CachedBeaconStateAllForks);

      expect(observer.onCheckpoint).toHaveBeenCalledWith(checkpoint, {});
      expect(observer.onCheckpoint).toHaveBeenCalledOnce();
    });

    it("should not subscribe if observer doesn't implement any event handler", () => {
      class EmptyChainObserver extends ChainObserver {}
      const emptyObserver = new EmptyChainObserver({logger});

      emptyObserver.subscribe(emitter);

      // The code checks which handlers exist. Since none are implemented,
      // no listeners should be attached to the emitter.
      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(0);
      expect(emitter.listenerCount(ChainEvent.forkChoiceJustified)).toBe(0);
      expect(emitter.listenerCount(ChainEvent.forkChoiceFinalized)).toBe(0);
    });

    it("should subscribe to multiple events if observer implements them", () => {
      class MultiEventObserver extends ChainObserver {
        onCheckpoint(_checkpoint: Checkpoint) {}
        onForkChoiceJustified() {}
      }
      const multiObs = new MultiEventObserver({logger});
      vi.spyOn(multiObs, "onCheckpoint").mockResolvedValue();
      vi.spyOn(multiObs, "onForkChoiceJustified").mockResolvedValue();

      multiObs.subscribe(emitter);

      // Emit both events to ensure each is handled
      emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);
      emitter.emit(ChainEvent.forkChoiceJustified, {} as CheckpointWithHex);

      expect(multiObs.onCheckpoint).toHaveBeenCalledTimes(1);
      expect(multiObs.onForkChoiceJustified).toHaveBeenCalledTimes(1);
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
      observer = new CustomQueueObserver({
        logger,
        maxQueueLength: 10,
        signal: controller.signal,
      });
      vi.spyOn(observer, "onCheckpoint").mockResolvedValue();
    });

    it("should subscribe to events", () => {
      observer.subscribe(emitter);
      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(1);
    });

    it("should not subscribe if observer doesn't implement any event handler", () => {
      class EmptyQueueObserver extends QueueObserver {}
      const emptyQObserver = new EmptyQueueObserver({
        logger,
        maxQueueLength: 10,
        signal: controller.signal,
      });

      emptyQObserver.subscribe(emitter);
      // With no handlers, no listeners should be attached
      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(0);
      expect(emitter.listenerCount(ChainEvent.forkChoiceJustified)).toBe(0);
      expect(emitter.listenerCount(ChainEvent.forkChoiceFinalized)).toBe(0);
    });

    it("should create a queue if maxQueueLength is given", () => {
      expect(observer["jobQueue"]).toBeInstanceOf(JobItemQueue);
      expect(observer["jobQueue"]["opts"].maxLength).toBe(10);
    });

    it("should call right handler on event emit", async () => {
      const checkpoint = {} as Checkpoint;
      observer.subscribe(emitter);
      emitter.emit(ChainEvent.checkpoint, checkpoint, {} as CachedBeaconStateAllForks);

      // As the event is triggered in a queue, give it some time
      await sleep(50);

      expect(observer.onCheckpoint).toHaveBeenCalledWith(checkpoint, {});
      expect(observer.onCheckpoint).toHaveBeenCalledOnce();
    });

    it("should call handler in sequence", async () => {
      const checkpoint1 = {message: "checkpoint-1"} as unknown as Checkpoint;
      const checkpoint2 = {message: "checkpoint-2"} as unknown as Checkpoint;

      // Mock the handler to take time, simulating a long-running task
      vi.spyOn(observer, "onCheckpoint").mockImplementation(async () => {
        await sleep(50);
      });

      observer.subscribe(emitter);
      emitter.emit(ChainEvent.checkpoint, checkpoint1, {} as CachedBeaconStateAllForks);
      emitter.emit(ChainEvent.checkpoint, checkpoint2, {} as CachedBeaconStateAllForks);

      // Wait enough time for both items to process in sequence
      await sleep(150);

      expect(observer.onCheckpoint).toHaveBeenCalledTimes(2);
      expect(observer.onCheckpoint).toHaveBeenNthCalledWith(1, checkpoint1, {});
      expect(observer.onCheckpoint).toHaveBeenNthCalledWith(2, checkpoint2, {});
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

    it("should raise an error when reaching maxQueueLength", async () => {
      // Create a observer with maxQueueLength = 1
      observer = new CustomQueueObserver({
        logger,
        maxQueueLength: 1,
        signal: controller.signal,
      });
      observer.subscribe(emitter);

      // The first emit should be fine...
      emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);

      // The second emit should throw due to the queue limit
      expect(() => {
        emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);
      }).toThrow("QUEUE_ERROR_QUEUE_MAX_LENGTH");
    });

    it("should continue processing events if one observer handler throws", async () => {
      class ErrorObserver extends QueueObserver {
        onCheckpoint(checkpoint: Checkpoint) {
          if (checkpoint === ("error" as unknown as Checkpoint)) {
            throw new Error("Handler failed");
          }
        }
      }
      const errorObserver = new ErrorObserver({logger, signal: controller.signal, maxQueueLength: 10});
      vi.spyOn(errorObserver, "onCheckpoint");
      errorObserver.subscribe(emitter);

      emitter.emit(ChainEvent.checkpoint, "error" as unknown as Checkpoint, {} as CachedBeaconStateAllForks);
      emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);
      await sleep(50);

      // Handler was called twice on errorObserver
      expect(errorObserver.onCheckpoint).toHaveBeenCalledTimes(2);
    });
  });

  describe("MediatorQueueObserver", () => {
    class CustomObserver1 extends BaseObserver {
      onCheckpoint(_checkpoint: Checkpoint) {}
    }

    class CustomObserver2 extends BaseObserver {
      onCheckpoint(_checkpoint: Checkpoint) {}
    }

    let emitter: ChainEventEmitter;
    let mediator: MediatorQueueObserver;
    let logger: Logger;
    let controller: AbortController;
    let observer1: CustomObserver1;
    let observer2: CustomObserver2;

    beforeEach(() => {
      controller = new AbortController();
      logger = getMockedLogger();
      emitter = new ChainEventEmitter();
      mediator = new MediatorQueueObserver({
        logger,
        maxQueueLength: 10,
        signal: controller.signal,
      });
      observer1 = new CustomObserver1({logger});
      observer2 = new CustomObserver2({logger});

      mediator.registerObserver(observer1);
      mediator.registerObserver(observer2);

      vi.spyOn(observer1, "onCheckpoint");
      vi.spyOn(observer2, "onCheckpoint");
    });

    it("should subscribe to events", () => {
      mediator.subscribe(emitter);
      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(1);
    });

    it("should create a queue if maxQueueLength is given", () => {
      expect(mediator["jobQueue"]).toBeInstanceOf(JobItemQueue);
      expect(mediator["jobQueue"]["opts"].maxLength).toBe(10);
    });

    it("should call right handler on event emit", async () => {
      const checkpoint = {} as Checkpoint;
      mediator.subscribe(emitter);
      emitter.emit(ChainEvent.checkpoint, checkpoint, {} as CachedBeaconStateAllForks);

      // Give the queue time to process
      await sleep(50);

      expect(observer1.onCheckpoint).toHaveBeenCalledWith(checkpoint, {});
      expect(observer2.onCheckpoint).toHaveBeenCalledOnce();
    });

    it("should call handler in sequence", async () => {
      const callOrder: string[] = [];
      const checkpoint1 = "checkpoint-1" as unknown as Checkpoint;
      const checkpoint2 = "checkpoint-2" as unknown as Checkpoint;

      vi.spyOn(observer1, "onCheckpoint").mockImplementation(async (checkpoint) => {
        await sleep(25);
        callOrder.push(`observer1-onCheckpoint-${checkpoint}`);
      });
      vi.spyOn(observer2, "onCheckpoint").mockImplementation(async (checkpoint) => {
        await sleep(25);
        callOrder.push(`observer2-onCheckpoint-${checkpoint}`);
      });

      mediator.subscribe(emitter);
      emitter.emit(ChainEvent.checkpoint, checkpoint1, {} as CachedBeaconStateAllForks);
      emitter.emit(ChainEvent.checkpoint, checkpoint2, {} as CachedBeaconStateAllForks);

      await sleep(150);

      // Each observer sees both events, in order
      expect(observer1.onCheckpoint).toHaveBeenCalledTimes(2);
      expect(observer2.onCheckpoint).toHaveBeenCalledTimes(2);
      expect(observer1.onCheckpoint).toHaveBeenNthCalledWith(1, checkpoint1, {});
      expect(observer1.onCheckpoint).toHaveBeenNthCalledWith(2, checkpoint2, {});
      expect(observer2.onCheckpoint).toHaveBeenNthCalledWith(1, checkpoint1, {});
      expect(observer2.onCheckpoint).toHaveBeenNthCalledWith(2, checkpoint2, {});

      // Confirm the call order is strictly sequential
      expect(callOrder).toEqual([
        "observer1-onCheckpoint-checkpoint-1",
        "observer2-onCheckpoint-checkpoint-1",
        "observer1-onCheckpoint-checkpoint-2",
        "observer2-onCheckpoint-checkpoint-2",
      ]);
    });

    it("should cleanup all handlers on unsubscribe", () => {
      mediator.subscribe(emitter);
      mediator.unsubscribe();

      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(0);
    });

    it("should cleanup all handlers on abort", () => {
      const controller = new AbortController();
      mediator.subscribe(emitter, controller.signal);

      controller.abort();

      expect(emitter.listenerCount(ChainEvent.checkpoint)).toBe(0);
    });

    it("should not register one observer multiple times", async () => {
      mediator.registerObserver(observer1);
      mediator.registerObserver(observer1);
      mediator.subscribe(emitter);

      emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);
      await sleep(150);

      expect(observer1.onCheckpoint).toBeCalledTimes(1);
    });

    it("should not fail if an observer does not implement a particular event handler", async () => {
      class PartialObserver extends BaseObserver {
        // intentionally no onForkChoiceJustified
      }
      const partialObserver = new PartialObserver({logger});
      mediator.registerObserver(partialObserver);

      mediator.subscribe(emitter);
      // Emit an event the partialObserver doesn't implement
      emitter.emit(ChainEvent.forkChoiceJustified, {} as CheckpointWithHex);
      await sleep(50);

      // Passes if no crash or unhandled error is thrown
    });

    it("should raise an error when reaching maxQueueLength", async () => {
      // Create a mediator with maxQueueLength = 1
      mediator = new MediatorQueueObserver({
        logger,
        maxQueueLength: 1,
        signal: controller.signal,
      });
      mediator.registerObserver(observer1);
      mediator.subscribe(emitter);

      // The first emit should be fine...
      emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);

      // The second emit should throw due to the queue limit
      expect(() => {
        emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);
      }).toThrow("QUEUE_ERROR_QUEUE_MAX_LENGTH");
    });

    it("should continue processing events if one observer handler throws", async () => {
      class ErrorObserver extends BaseObserver {
        onCheckpoint(checkpoint: Checkpoint) {
          if (checkpoint === ("error" as unknown as Checkpoint)) {
            throw new Error("Handler failed");
          }
        }
      }
      const errorObserver = new ErrorObserver({logger});
      vi.spyOn(errorObserver, "onCheckpoint");

      mediator.registerObserver(errorObserver);
      mediator.registerObserver(observer1); // observer1 never throws

      mediator.subscribe(emitter);

      emitter.emit(ChainEvent.checkpoint, "error" as unknown as Checkpoint, {} as CachedBeaconStateAllForks);
      emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);
      await sleep(50);

      // Handler was called twice on errorObserver
      expect(errorObserver.onCheckpoint).toHaveBeenCalledTimes(2);

      // Observer1 still processes both events
      expect(observer1.onCheckpoint).toHaveBeenCalledTimes(2);
    });

    it("should stop adding new events to the queue if unsubscribed", async () => {
      mediator.subscribe(emitter);

      // Emit one event
      emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);
      // Immediately unsubscribe
      mediator.unsubscribe();

      // Emit another event after unsubscribing
      emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);
      await sleep(50);

      // Confirm the second event is never processed
      expect(observer1.onCheckpoint).toHaveBeenCalledTimes(1);
      expect(observer2.onCheckpoint).toHaveBeenCalledTimes(1);
    });

    it("should handle the scenario where no observers are registered", async () => {
      // Create a brand-new mediator with no observers
      const noObserverMediator = new MediatorQueueObserver({
        logger,
        maxQueueLength: 10,
        signal: controller.signal,
      });
      noObserverMediator.subscribe(emitter);

      // Emit some event
      emitter.emit(ChainEvent.checkpoint, {} as Checkpoint, {} as CachedBeaconStateAllForks);
      // If no error is thrown and queue processes normally, we're good
      await sleep(50);
    });
  });
});

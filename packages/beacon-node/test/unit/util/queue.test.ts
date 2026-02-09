import {describe, expect, it} from "vitest";
import {sleep} from "@lodestar/utils";
import {JobFnQueue, JobItemQueue, QueueError, QueueErrorCode, QueueType} from "../../../src/util/queue/index.js";
import {expectLodestarError, expectRejectedWithLodestarError} from "../../utils/errors.js";

describe("Job queue", () => {
  const maxLength = 3;
  const jobDuration = 20;

  it("should only allow a single job at a time to run", async () => {
    const controller = new AbortController();
    const jobQueue = new JobFnQueue({maxLength, signal: controller.signal});

    let activeJobs = 0;
    async function job(): Promise<void> {
      activeJobs++;
      await sleep(jobDuration);
      if (activeJobs > 1) {
        throw new Error();
      }
      activeJobs--;
    }

    // Start all jobs at the same time
    // expect none of the jobs to be running simultaneously
    await Promise.all(Array.from({length: maxLength}, () => jobQueue.push(job)));
  });

  it("should throw after the queue is full", async () => {
    const controller = new AbortController();
    const jobQueue = new JobFnQueue({maxLength, signal: controller.signal});

    async function job(): Promise<void> {
      await sleep(jobDuration);
    }
    // Start `maxLength` # of jobs at the same time
    // the queue is now full
    const jobs = Promise.all(Array.from({length: maxLength}, () => jobQueue.push(job)));

    // the next enqueued job should go over the limit
    await expectRejectedWithLodestarError(
      wrapFn(() => jobQueue.push(job)),
      new QueueError({code: QueueErrorCode.QUEUE_MAX_LENGTH})
    );

    await jobs;
  });

  it("should throw after the queue is aborted", async () => {
    const controller = new AbortController();
    const jobQueue = new JobFnQueue({maxLength, signal: controller.signal});

    async function job(): Promise<void> {
      await sleep(jobDuration);
    }
    const jobs = Promise.allSettled(Array.from({length: maxLength}, () => jobQueue.push(job)));
    controller.abort();
    const results = await jobs;

    // all jobs should be rejected with ERR_QUEUE_ABORTED
    for (const e of results) {
      if (e.status === "rejected") {
        expectLodestarError(e.reason, new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
      } else {
        expect.fail();
      }
    }

    // any subsequently enqueued job should also be rejected
    await expectRejectedWithLodestarError(
      wrapFn(() => jobQueue.push(job)),
      new QueueError({code: QueueErrorCode.QUEUE_ABORTED})
    );
  });

  describe("Queue types", () => {
    const jobCount = 3;
    const testCases: {type: QueueType; expectedResults: number[]}[] = [
      // FIFO should pick the first jobs first
      {type: QueueType.FIFO, expectedResults: [0, 1, 2]},
      // LIFO should pick the last jobs first
      {type: QueueType.LIFO, expectedResults: [2, 1, 0]},
    ];

    for (const {type, expectedResults} of testCases) {
      it(type, async () => {
        const controller = new AbortController();
        const jobQueue = new JobFnQueue({maxLength, type, signal: controller.signal});

        const results: number[] = [];
        const jobPromises: Promise<void>[] = [];

        for (let i = 0; i < jobCount; i++) {
          jobPromises.push(
            jobQueue.push(async () => {
              await sleep(0);
              results.push(i);
            })
          );
        }

        const jobResults = await Promise.allSettled(jobPromises);

        for (const [_, jobResult] of jobResults.entries()) {
          expect(jobResult.status).toBe("fulfilled");
        }

        expect(results).toEqual(expectedResults);
      });
    }
  });

  describe("waitForSpace", () => {
    const maxLength = 2;
    const jobDuration = 50;

    it("should resolve immediately when queue has space", async () => {
      const controller = new AbortController();
      const jobQueue = new JobItemQueue<[number], number>(async (n) => n, {maxLength, signal: controller.signal});

      // Queue is empty, waitForSpace should resolve immediately
      await jobQueue.waitForSpace();
      controller.abort();
    });

    it("should wait until space is available when queue is full", async () => {
      const controller = new AbortController();
      const jobQueue = new JobItemQueue<[number], number>(
        async (n) => {
          await sleep(jobDuration);
          return n;
        },
        {maxLength, signal: controller.signal}
      );

      // Fill the queue
      const jobs = Array.from({length: maxLength}, (_, i) => jobQueue.push(i));

      // Queue is full, waitForSpace should block
      let spaceAvailable = false;
      const waitPromise = jobQueue.waitForSpace().then(() => {
        spaceAvailable = true;
      });

      // Give a tick for the wait to register
      await sleep(5);
      expect(spaceAvailable).toBe(false);

      // Wait for a job to complete, which should free space
      await Promise.all(jobs);
      await waitPromise;
      expect(spaceAvailable).toBe(true);

      controller.abort();
    });

    it("should reject when aborted while waiting", async () => {
      const controller = new AbortController();
      const jobQueue = new JobItemQueue<[number], number>(
        async (n) => {
          await sleep(jobDuration);
          return n;
        },
        {maxLength, signal: controller.signal}
      );

      // Fill the queue (catch rejections from abort to avoid unhandled rejection errors)
      const jobs = Array.from({length: maxLength}, (_, i) => jobQueue.push(i).catch(() => 0));

      // Wait for space, then abort
      const waitPromise = jobQueue.waitForSpace();
      controller.abort();

      await expectRejectedWithLodestarError(waitPromise, new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
      await Promise.allSettled(jobs);
    });

    it("should only wake one waiter per available slot (no thundering herd)", async () => {
      const controller = new AbortController();
      const jobQueue = new JobItemQueue<[number], number>(
        async (n) => {
          await sleep(jobDuration);
          return n;
        },
        {maxLength, signal: controller.signal}
      );

      // Fill the queue
      const jobs = Array.from({length: maxLength}, (_, i) => jobQueue.push(i));

      // Register multiple waiters
      const resolved: number[] = [];
      const waiter1 = jobQueue.waitForSpace().then(() => resolved.push(1));
      const waiter2 = jobQueue.waitForSpace().then(() => resolved.push(2));

      // Wait for one job to complete (frees 1 slot)
      await sleep(jobDuration + 10);

      // Give microtasks time to settle
      await sleep(5);

      // Only one waiter should have been resolved (1 slot freed)
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBe(1);

      // Wait for the rest to complete
      await Promise.all(jobs);
      await Promise.all([waiter1, waiter2]);
      expect(resolved).toHaveLength(2);

      controller.abort();
    });
  });
});

async function wrapFn(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (e) {
    return Promise.reject(e);
  }
}

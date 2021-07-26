import {sleep} from "@chainsafe/lodestar-utils";
import {AbortController} from "@chainsafe/abort-controller";
import {expect} from "chai";

import {JobFnQueue, QueueError, QueueErrorCode, QueueType} from "../../../src/util/queue";
import {expectLodestarError, expectRejectedWithLodestarError} from "../../utils/errors";

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

        for (const [i, jobResult] of jobResults.entries()) {
          expect(jobResult.status).to.equal("fulfilled", `Job ${i} rejected`);
        }

        expect(results).to.deep.equal(expectedResults, "Wrong results");
      });
    }
  });
});

async function wrapFn(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (e) {
    return Promise.reject(e);
  }
}

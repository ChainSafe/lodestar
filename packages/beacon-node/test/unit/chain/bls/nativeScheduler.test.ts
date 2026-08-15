import {describe, expect, it} from "vitest";
import {defer} from "@lodestar/utils";
import {NativeBlsScheduler} from "../../../../src/chain/bls/multithread/nativeScheduler.js";

describe("NativeBlsScheduler", () => {
  it("admits critical work after normal work fills the executor width", async () => {
    const scheduler = new NativeBlsScheduler(2, () => {});
    const started: string[] = [];
    const releases = {
      normal1: defer<void>(),
      normal2: defer<void>(),
      normal3: defer<void>(),
      critical1: defer<void>(),
      critical2: defer<void>(),
      critical3: defer<void>(),
    };

    const normal1 = scheduleBlocked(scheduler, false, "normal1", releases.normal1.promise, started);
    const normal2 = scheduleBlocked(scheduler, false, "normal2", releases.normal2.promise, started);
    expect(scheduler.canAcceptNormalWork).toBe(false);
    const normal3 = scheduleBlocked(scheduler, false, "normal3", releases.normal3.promise, started);
    const critical1 = scheduleBlocked(scheduler, true, "critical1", releases.critical1.promise, started);
    const critical2 = scheduleBlocked(scheduler, true, "critical2", releases.critical2.promise, started);
    const critical3 = scheduleBlocked(scheduler, true, "critical3", releases.critical3.promise, started);

    expect(started).toEqual(["normal1", "normal2", "critical1", "critical2"]);

    releases.critical1.resolve();
    await critical1;
    expect(started).toEqual(["normal1", "normal2", "critical1", "critical2", "critical3"]);

    releases.critical2.resolve();
    releases.critical3.resolve();
    await Promise.all([critical2, critical3]);
    expect(started).not.toContain("normal3");

    releases.normal1.resolve();
    await normal1;
    expect(started.at(-1)).toBe("normal3");

    releases.normal2.resolve();
    releases.normal3.resolve();
    await Promise.all([normal2, normal3]);
    await scheduler.close(Error("closed"));
  });

  it("rejects queued work and drains submitted work on close", async () => {
    const scheduler = new NativeBlsScheduler(1, () => {});
    const release = defer<void>();
    const running = scheduler.schedule(false, 1, async () => {
      await release.promise;
      return true;
    });
    const queued = scheduler.schedule(false, 1, async () => true);
    const closeError = Error("closed");

    const closePromise = scheduler.close(closeError);
    await expect(queued).rejects.toBe(closeError);
    await expect(scheduler.schedule(false, 1, async () => true)).rejects.toBe(closeError);

    release.resolve();
    await expect(running).resolves.toBe(true);
    await closePromise;
    expect(scheduler.activeJobs).toBe(0);
  });
});

function scheduleBlocked(
  scheduler: NativeBlsScheduler,
  critical: boolean,
  name: string,
  release: Promise<void>,
  started: string[]
): Promise<string> {
  return scheduler.schedule(critical, 1, async () => {
    started.push(name);
    await release;
    return name;
  });
}

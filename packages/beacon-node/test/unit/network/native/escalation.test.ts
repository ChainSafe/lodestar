import {spawnSync} from "node:child_process";
import {describe, expect, it} from "vitest";

describe("native pump escalation", () => {
  it.each([1, 3])(
    "trigger %i terminates the process through native fatalError",
    (trigger) => {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "test/utils/nativeEscalation.ts", String(trigger)],
        {
          encoding: "utf8",
          timeout: 60_000,
        }
      );
      expect(result.signal).toBe("SIGABRT");
      expect(result.stdout).not.toContain("survived");
      expect(result.stderr).toContain(`native network bridge escalation trigger ${trigger}`);
    },
    90_000
  );

  it("a close whose exchanges keep failing settles or escalates with no other handle alive", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "test/utils/nativeEscalation.ts", "close"], {
      encoding: "utf8",
      timeout: 60_000,
    });
    const closed = result.status === 0 && result.stdout.includes("closed");
    const escalated =
      result.signal === "SIGABRT" && result.stderr.includes("native network bridge escalation trigger 3");
    expect(closed || escalated, JSON.stringify(result)).toBe(true);
  }, 90_000);
});

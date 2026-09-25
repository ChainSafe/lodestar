import {spawnSync} from "node:child_process";
import {describe, expect, it} from "vitest";

describe("native pump escalation", () => {
  it.each([1, 3, 4])(
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
});

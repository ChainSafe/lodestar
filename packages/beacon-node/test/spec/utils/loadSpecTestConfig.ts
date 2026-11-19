import fs from "node:fs";
import path from "node:path";
import jsyaml from "js-yaml";
import {ChainConfig, chainConfigFromJson} from "@lodestar/config";

export function loadSpecTestConfig(testCaseDir: string): Partial<ChainConfig> {
  const configPath = path.join(testCaseDir, "config.yaml");
  if (!fs.existsSync(configPath)) return {};

  // Parse config scalars as raw strings so byte values such as `0x00000001`
  // keep their leading zeros before passing through `chainConfigFromJson()`.
  // FAILSAFE_SCHEMA produces strings for scalars and preserves arrays/objects
  // (e.g. `BLOB_SCHEDULE`) as-is for `chainConfigFromJson` to deserialize.
  const configJson = jsyaml.load(fs.readFileSync(configPath, "utf8"), {
    schema: jsyaml.FAILSAFE_SCHEMA,
  }) as Record<string, unknown>;

  return chainConfigFromJson(configJson);
}

import {describe, expect, it, vi} from "vitest";
import {fetch, fromHex} from "@lodestar/utils";
import {ethereumConsensusSpecsTests} from "../../../beacon-node/test/spec/specTestVersioning.js";
import {chainConfig as mainnetChainConfig} from "../../src/chainConfig/configs/mainnet.js";
import {chainConfig as minimalChainConfig} from "../../src/chainConfig/configs/minimal.js";
import {ChainConfig} from "../../src/chainConfig/types.js";

// Not e2e, but slow. Run with e2e tests

/**
 * Fields that we filter from remote config when doing comparison.
 * These are network-specific values that differ from the spec defaults,
 * have special formats that require custom handling, or are not yet implemented.
 */
const ignoredRemoteConfigFields: (keyof ChainConfig)[] = [
  // BLOB_SCHEDULE is an array/JSON format that requires special parsing
  "BLOB_SCHEDULE" as keyof ChainConfig,
  // EIP-7805 (Inclusion Lists) - not yet implemented in Lodestar
  "VIEW_FREEZE_CUTOFF_BPS" as keyof ChainConfig,
  "INCLUSION_LIST_SUBMISSION_DUE_BPS" as keyof ChainConfig,
  "PROPOSER_INCLUSION_LIST_CUTOFF_BPS" as keyof ChainConfig,
  "MAX_REQUEST_INCLUSION_LIST" as keyof ChainConfig,
  "MAX_BYTES_PER_INCLUSION_LIST" as keyof ChainConfig,
  // Networking params that may be in presets instead of chainConfig
  "ATTESTATION_SUBNET_COUNT" as keyof ChainConfig,
  "ATTESTATION_SUBNET_EXTRA_BITS" as keyof ChainConfig,
  "ATTESTATION_SUBNET_PREFIX_BITS" as keyof ChainConfig,
  // Future spec params not yet in Lodestar
  "EPOCHS_PER_SHUFFLING_PHASE" as keyof ChainConfig,
  "PROPOSER_SELECTION_GAP" as keyof ChainConfig,
  // Network-specific fork epochs and versions - these vary per network deployment
  // and are not meant to be synced from the spec defaults
  "ALTAIR_FORK_EPOCH",
  "BELLATRIX_FORK_EPOCH",
  "CAPELLA_FORK_EPOCH",
  "DENEB_FORK_EPOCH",
  "ELECTRA_FORK_EPOCH",
  "FULU_FORK_EPOCH",
  "GLOAS_FORK_EPOCH",
  // Terminal values are network-specific
  "TERMINAL_TOTAL_DIFFICULTY",
  "TERMINAL_BLOCK_HASH",
  "TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH",
  // Genesis values are network-specific
  "MIN_GENESIS_TIME",
  "MIN_GENESIS_ACTIVE_VALIDATOR_COUNT",
  "GENESIS_DELAY",
  "GENESIS_FORK_VERSION",
  // These are preset values, not config values - they're tested separately
  "PRESET_BASE",
  "CONFIG_NAME",
];

/**
 * Fields that we filter from local config when doing comparison.
 * Ideally this should be empty as it is not spec compliant.
 */
const ignoredLocalConfigFields: (keyof ChainConfig)[] = [];

describe("Ensure chainConfig is synced", () => {
  vi.setConfig({testTimeout: 60 * 1000});

  it("mainnet chainConfig values match spec", async () => {
    const remoteConfig = await downloadRemoteConfig("mainnet", ethereumConsensusSpecsTests.specVersion);
    assertCorrectConfig({...mainnetChainConfig}, remoteConfig);
  });

  it("minimal chainConfig values match spec", async () => {
    const remoteConfig = await downloadRemoteConfig("minimal", ethereumConsensusSpecsTests.specVersion);
    assertCorrectConfig({...minimalChainConfig}, remoteConfig);
  });
});

function assertCorrectConfig(localConfig: ChainConfig, remoteConfig: Partial<ChainConfig>): void {
  // Filter out ignored fields from local config
  const filteredLocalConfig: Partial<ChainConfig> = {};
  for (const key of Object.keys(localConfig) as (keyof ChainConfig)[]) {
    if (!ignoredLocalConfigFields.includes(key)) {
      (filteredLocalConfig as Record<string, unknown>)[key] = localConfig[key];
    }
  }

  // Filter out ignored fields from remote config
  const filteredRemoteConfig: Partial<ChainConfig> = {};
  for (const key of Object.keys(remoteConfig) as (keyof ChainConfig)[]) {
    if (!ignoredRemoteConfigFields.includes(key)) {
      (filteredRemoteConfig as Record<string, unknown>)[key] = remoteConfig[key];
    }
  }

  // Check each key for better debuggability
  for (const key of Object.keys(filteredRemoteConfig) as (keyof ChainConfig)[]) {
    const localValue = filteredLocalConfig[key];
    const remoteValue = filteredRemoteConfig[key];

    // If localValue is undefined, it means a config is missing from our local implementation
    if (localValue === undefined) {
      expect(localValue).toBeWithMessage(remoteValue, `${key} is present in remote spec but not in local config`);
      continue;
    }

    // Skip if remoteValue is undefined (local-only field)
    if (remoteValue === undefined) {
      continue;
    }

    // Handle BigInt comparison
    if (typeof localValue === "bigint" || typeof remoteValue === "bigint") {
      expect(BigInt(localValue as bigint)).toBeWithMessage(
        BigInt(remoteValue as bigint),
        `${key} does not match: local=${localValue}, remote=${remoteValue}`
      );
    }
    // Handle Uint8Array (hex bytes) comparison
    else if (localValue instanceof Uint8Array || remoteValue instanceof Uint8Array) {
      const localHex = Buffer.from(localValue as Uint8Array).toString("hex");
      const remoteHex = Buffer.from(remoteValue as Uint8Array).toString("hex");
      expect(localHex).toBeWithMessage(remoteHex, `${key} does not match: local=0x${localHex}, remote=0x${remoteHex}`);
    }
    // Handle number/string comparison
    else {
      expect(localValue).toBeWithMessage(
        remoteValue,
        `${key} does not match: local=${localValue}, remote=${remoteValue}`
      );
    }
  }
}

async function downloadRemoteConfig(network: "mainnet" | "minimal", commit: string): Promise<Partial<ChainConfig>> {
  const url = `https://raw.githubusercontent.com/ethereum/consensus-specs/${commit}/configs/${network}.yaml`;
  const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return parseConfigYaml(await response.text());
}

function parseConfigYaml(yaml: string): Partial<ChainConfig> {
  const config: Record<string, unknown> = {};

  for (const line of yaml.split("\n")) {
    // Skip comments and empty lines
    if (line.startsWith("#") || line.trim() === "") {
      continue;
    }

    const match = line.match(/^([A-Z_]+):\s*(.+)$/);
    if (match) {
      const [, key, rawValue] = match;
      const value = rawValue.trim().replace(/^(['"])(.*)\\1$/, "$2"); // Remove matching quotes

      // Parse the value based on its format
      if (value.startsWith("0x")) {
        // Hex bytes
        config[key] = fromHex(value);
      } else if (/^\d+$/.test(value)) {
        // Integer - use BigInt for large numbers, number for small ones
        const num = BigInt(value);
        // Use number if it fits, BigInt for large values
        config[key] = num <= Number.MAX_SAFE_INTEGER ? Number(num) : num;
      } else {
        // String value (like preset name)
        config[key] = value;
      }
    }
  }

  return config as Partial<ChainConfig>;
}

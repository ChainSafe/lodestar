// MUST import this file first before anything and not import any Lodestar code.
import os from "node:os";

// eslint-disable-next-line no-restricted-imports
import {hasher} from "@chainsafe/persistent-merkle-tree/lib/hasher/as-sha256.js";
// eslint-disable-next-line no-restricted-imports
import {setHasher} from "@chainsafe/persistent-merkle-tree/lib/hasher/index.js";

// without setting this first, persistent-merkle-tree will use noble instead
setHasher(hasher);

//
// ## Rationale
//
// Lodestar implemented PRESET / CONFIG separation to allow importing types and preset constants directly
// see https://github.com/ChainSafe/lodestar/pull/2585
//
// However this prevents dynamic configuration changes which is exactly what the CLI required before.
// - The dev command can't apply the minimal preset dynamically
// - `--network gnosis` can't apply a different preset dynamically
// - `--network chiado` can't apply a different preset dynamically
//
// Running this file allows us to keep a static export strategy while NOT requiring users to
// set LODESTAR_PRESET manually every time.

// IMPORTANT: only import Lodestar code here which does not import any other Lodestar libraries
import {setActivePreset, presetFromJson, PresetName} from "@lodestar/params/setPreset";
import {readFile} from "./util/file.js";

const network = valueOfArg("network");
const preset = valueOfArg("preset");
const presetFile = valueOfArg("presetFile");
const uvThreadpoolSize = valueOfArg("uvThreadpoolSize");

// Apply preset flag if present
if (preset) {
  process.env.LODESTAR_PRESET = preset;
}

// If ENV is set overrides, network (otherwise can not override network --dev in mainnet mode)
else if (process.env.LODESTAR_PRESET) {
  // break
}

// Translate network to preset
else if (network) {
  if (network === "dev") {
    process.env.LODESTAR_PRESET = "minimal";
    // "c-kzg" has hardcoded the mainnet value, do not use presets
    // eslint-disable-next-line @typescript-eslint/naming-convention
    setActivePreset(PresetName.minimal, {FIELD_ELEMENTS_PER_BLOB: 4096});
  } else if (network === "gnosis" || network === "chiado") {
    process.env.LODESTAR_PRESET = "gnosis";
  }
}

// If running dev top level command `$ lodestar dev`, apply minimal
else if (process.argv[2] === "dev") {
  process.env.LODESTAR_PRESET = "minimal";
  process.env.LODESTAR_NETWORK = "dev";
  // "c-kzg" has hardcoded the mainnet value, do not use presets
  // eslint-disable-next-line @typescript-eslint/naming-convention
  setActivePreset(PresetName.minimal, {FIELD_ELEMENTS_PER_BLOB: 4096});
}

/**
 * Sets the libuv thread pool size for worker threads.  This is a critical
 * component for effective node operations.  Setting the environment variable
 * must happen almost at the beginning of startup, BEFORE the worker pool is
 * created by libuv.
 *
 * The trigger for creation of the libuv worker pool is scheduling async work
 * that will queue for a worker.  An example of things that can trigger that
 * condition are async reading files from the OS.  Some network operations and
 * any native modules that utilize async work (like @chainsafe/blst-ts).
 *
 * Setting this value higher than the number of logical cores will not be a benefit
 * because the kernel will need to do context switching to parallelize the work
 * on a number of cores that is less than the number of requested threads.
 *
 * Setting this number lower than then number of cores will reduce the amount of
 * bls work that can be concurrently done.  Something like 70% of the work the
 * cpu does to keep up with the chain is blst validation.
 *
 * There is a considerable amount of idle process time on both the main thread
 * and network thread and setting this value to overlap that work will allow the
 * kernel to utilize the idle time for additional bls verification.
 *
 * Empirical testing has shown that sizing the worker pool to be as large as
 * the number of logical cores is optimal but this may change in the future.
 */
const defaultThreadpoolSize = os.availableParallelism();
if (uvThreadpoolSize) {
  process.env.UV_THREADPOOL_SIZE = uvThreadpoolSize;
} else if (process.env.UV_THREADPOOL_SIZE) {
  /* no-op let user-set value carry through */
} else {
  process.env.UV_THREADPOOL_SIZE = defaultThreadpoolSize.toString();
}

if (isNaN(parseInt(`${process.env.UV_THREADPOOL_SIZE}`))) {
  // eslint-disable-next-line no-console
  console.warn(
    `UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE}, but must be set to a number. Using default value of ${defaultThreadpoolSize}`
  );
  process.env.UV_THREADPOOL_SIZE = defaultThreadpoolSize.toString();
}

if (presetFile) {
  // Override the active preset with custom values from file
  // Do not modify the preset to use as a base by passing null
  setActivePreset(null, presetFromJson(readFile(presetFile) ?? {}));
}

/**
 * Valid syntax
 * - `--preset minimal`
 * - `--preset=minimal`
 */
function valueOfArg(argName: string): string | null {
  // Syntax `--preset minimal`
  // process.argv = ["--preset", "minimal"];

  {
    const index = process.argv.indexOf(`--${argName}`);
    if (index > -1) {
      return process.argv[index + 1] ?? "";
    }
  }

  // Syntax `--preset=minimal`
  {
    const prefix = `--${argName}=`;
    const item = process.argv.find((arg) => arg.startsWith(prefix));
    if (item) {
      return item.slice(prefix.length);
    }
  }

  return null;
}

// Add empty export to make this a module
export {};

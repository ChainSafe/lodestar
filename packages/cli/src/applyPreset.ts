// MUST import this file first before anything and not import any Lodestar code.
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

const network = valueOfArg("network");
const preset = valueOfArg("preset");

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
  } else if (network === "gnosis" || network === "chiado") {
    process.env.LODESTAR_PRESET = "gnosis";
  }
}

// If running dev top level command `$ lodestar dev`, apply minimal
else if (process.argv[2] === "dev") {
  process.env.LODESTAR_PRESET = "minimal";
  process.env.LODESTAR_NETWORK = "dev";
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

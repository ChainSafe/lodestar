// MUST import this file first before anything and not import any Lodestar code
const network = valueOfArg("network");
const preset = valueOfArg("preset");

// Apply preset flag if present
if (preset) {
  process.env.LODESTAR_PRESET = preset;
}

// Translate network to preset
else if (network) {
  if (network === "dev") {
    process.env.LODESTAR_PRESET = "minimal";
  } else if (network === "gnosis") {
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

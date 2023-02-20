import fs from "node:fs";
import path from "node:path";
import {Options} from "yargs";
import omit from "lodash/omit.js";
import {cmds} from "../src/cmds/index.js";
import {CliCommand} from "../src/util/index.js";
import {globalOptions} from "../src/options/index.js";
import {beaconOptions} from "../src/cmds/beacon/options.js";
import {renderMarkdownSections, toMarkdownTable, MarkdownSection} from "./markdown.js";

// Script to generate a reference of all CLI commands and options
// Outputs a markdown format ready to be consumed by mkdocs
//
// Usage:
// ts-node docsgen docs/cli.md
//
// After generation the resulting .md should be mv to the path expected
// by the mkdocs index and other existing paths in the documentation

const docsMarkdownPath = process.argv[2];
if (!docsMarkdownPath) throw Error("Run script with output path: 'ts-node docsgen docs/cli.md'");

const docsString = renderMarkdownSections([
  {
    title: "Command Line Reference",
    body: "This reference describes the syntax of the Lodestar CLI commands and their options.",
    subsections: [
      {
        title: "Global Options",
        body: getOptionsTable(globalOptions),
      },
      ...cmds.map((cmd) => cmdToMarkdownSection(cmd)),
    ],
  },
]);

fs.mkdirSync(path.parse(docsMarkdownPath).dir, {recursive: true});
fs.writeFileSync(docsMarkdownPath, docsString);

/**
 * Parse an CliCommand type recursively and output a MarkdownSection
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cmdToMarkdownSection(cmd: CliCommand<any>, parentCommand?: string): MarkdownSection {
  const commandJson = [parentCommand, cmd.command.replace("<command>", "")].filter(Boolean).join(" ");
  const body = [cmd.describe];

  if (cmd.examples) {
    body.push("**Examples**");
    for (const example of cmd.examples) {
      if (example.command.startsWith("lodestar")) example.command = `lodestar ${example.command}`;
      body.push(example.description);
      body.push(`\`\`\` \n${example.command}\n\`\`\``);
    }
  }

  if (cmd.options) {
    body.push("**Options**");

    if (cmd.subcommands) {
      body.push("The options below apply to all subcommands.");
    }

    // De-duplicate beaconOptions. If all beaconOptions exists in this command, skip them
    if (
      cmds.some((c) => c.command === "beacon") &&
      commandJson !== "beacon" &&
      Object.keys(beaconOptions).every((key) => cmd.options?.[key])
    ) {
      cmd.options = omit(cmd.options, Object.keys(beaconOptions));
      body.push(`Cmd \`${commandJson}\` has all the options from the [\`beacon\` cmd](#beacon).`);
    }

    body.push(getOptionsTable(cmd.options));
  }
  return {
    title: `\`${commandJson}\``,
    body,
    subsections: (cmd.subcommands || []).map((subcmd) => cmdToMarkdownSection(subcmd, commandJson)),
  };
}

/**
 * Render a Yargs options dictionary to a markdown table
 */
function getOptionsTable(options: Record<string, Options>, {showHidden}: {showHidden?: boolean} = {}): string {
  const visibleOptions = Object.entries(options).filter(([, opt]) => showHidden || !opt.hidden);

  if (visibleOptions.length === 0) {
    return "";
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  return toMarkdownTable(
    visibleOptions.map(([key, opt]) => ({
      Option: `\`--${key}\``,
      Type: opt.type ?? "",
      Description: opt.description ?? "",
      Default: String(opt.defaultDescription || opt.default || ""),
    })),
    ["Option", "Type", "Description", "Default"]
  );
}

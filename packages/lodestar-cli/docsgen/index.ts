import fs from "fs";
import path from "path";
import {Options} from "yargs";
import {cmds} from "../src/cmds";
import {ICliCommand} from "../src/util";
import {globalOptions} from "../src/options/globalOptions";
import {renderMarkdownSections, toMarkdownTable, IMarkdownSection} from "./markdown";


const docsMarkdownPath = process.argv[2];
if (!docsMarkdownPath) throw Error("Run script with output path: 'ts-node index.ts cli.md'");

const docsString = renderMarkdownSections([{
  title: "Lodestar CLI Documentation",
  body: "This reference describes the syntax of the Lodestar CLI options and commands.",
  subsections: [
    {
      title: "Global Options",
      body: getOptionsTable(globalOptions)
    },
    ...cmds.map(cmd => cmdToMarkdownSection(cmd))
  ]
}]);

fs.mkdirSync(path.parse(docsMarkdownPath).dir, {recursive: true});
fs.writeFileSync(docsMarkdownPath, docsString);

/**
 * Parse an ICliCommand type recursively and output a IMarkdownSection
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cmdToMarkdownSection(cmd: ICliCommand<any>, parentCommand?: string): IMarkdownSection {
  const commandJson = [parentCommand, cmd.command.replace("<command>", "")].filter(Boolean).join(" ");
  const bodyParts = [cmd.describe];
  if (cmd.options) {
    if (cmd.subcommands) {
      bodyParts.push("The options below apply to all subcommands.");
    }
    bodyParts.push(getOptionsTable(cmd.options));
  }
  return {
    title: `\`${commandJson}\``, 
    body: bodyParts.join("\n\n"),
    subsections: (cmd.subcommands || []).map(subcmd => cmdToMarkdownSection(subcmd, commandJson))
  };
}

/**
 * Render a Yargs options dictionary to a markdown table
 */
function getOptionsTable(
  options: Record<string, Options>,
  {showHidden}: {showHidden?: boolean} = {}
): string {
  return toMarkdownTable(Object.entries(options)
    .filter(([, opt]) => showHidden || !opt.hidden)
    .map(([key, opt]) => ({
      Option: `\`--${key}\``,
      Type: opt.type,
      Description: opt.description,
      Default: opt.defaultDescription || opt.default || ""
    })), ["Option", "Type", "Description", "Default"]);
}

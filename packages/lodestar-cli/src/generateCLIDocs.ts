import fs from "fs";
import {cmds} from "./cmds";
import {ICliCommand} from "./util";
import {Options} from "yargs";
import {globalOptions} from "./options/globalOptions";

interface IMarkdownSection {
  title: string;
  body: string;
  subsections?: IMarkdownSection[];
}

const docsMarkdownPath = process.argv[2];
if (!docsMarkdownPath) throw Error("Run script with output path: 'node docs.js doc.md'");

// let globalOptionsStr = "";
// for (const [key, value] of Object.entries(globalOptions)) {
//   if (!(key in paramsOptions))
//     globalOptionsStr = globalOptionsStr.concat(
//       `| ${key} | ${value.type} | ${value.description} | ${value.default || ""} |\n`
//     );
// }


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
fs.writeFileSync(docsMarkdownPath, docsString);

/**
 * Parse an ICliCommand type recursively and output a IMarkdownSection
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cmdToMarkdownSection(cmd: ICliCommand<any>, parentCommand?: string): IMarkdownSection {
  const commandJson = [parentCommand, cmd.command.replace("<command>", "")].filter(Boolean).join(" ");
  const section: IMarkdownSection = {
    title: `\`${commandJson}\``, 
    body: cmd.describe,
    subsections: []
  };
  if (cmd.options) {
    section.subsections.push({
      title: `\`${commandJson}\` options`,
      body: `These are the ${commandJson} command options \n\n ${getOptionsTable(cmd.options)}`,
    });
  }
  if (cmd.subcommands) {
    for (const subcmd of cmd.subcommands) {
      section.subsections.push(cmdToMarkdownSection(subcmd, commandJson));
    }
  }
  return section;
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
      Name: `\`--${key}\``,
      Type: opt.type,
      Description: opt.description,
      Default: opt.defaultDescription || opt.default || ""
    })), ["Name", "Type", "Description", "Default"]);
}


/**
 * Render IMarkdownSection recursively tracking its level depth
 */
function renderMarkdownSections(sections: IMarkdownSection[], level = 2): string {
  return sections.map(section => {
    const parts = section.title ? [`${"\n" + "#".repeat(level)} ${section.title}`] : [""];
    if (section.body) parts.push(section.body);
    if (section.subsections) parts.push(renderMarkdownSections(section.subsections, level + 1));
    return parts.join(section.title ? "\n" : "");
  }).join("\n");
}

/**
 * Render an array of objects as a markdown table
 */
function toMarkdownTable<T extends {[key: string]: string}>(rows: T[], headers: (keyof T)[]): string {
  return [
    toMarkdownTableRow(headers as string[]),
    toMarkdownTableRow(headers.map(() => "---")),
    ...rows.map(row => toMarkdownTableRow(headers.map(key => row[key])))
  ].join("\n");
}

/**
 * Render an array of items as a markdown table row
 */
function toMarkdownTableRow(row: string[]): string {
  return `| ${row.join(" | ")} |`;
}
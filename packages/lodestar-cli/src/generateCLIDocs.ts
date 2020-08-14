import {writeFile} from "fs";
import {cmds} from "./cmds";
import {ICliCommand} from "./util";
import {globalOptions} from "./options/globalOptions";
import {paramsOptions} from "./options/paramsOptions";

interface IMarkdownSection {
  title: string;
  body: string;
  subsections?: IMarkdownSection[];
}

const optionsTableHeader = "| Name | Type | Description |\n| ----------- | ----------- | ----------- |";

let globalOptionsStr = "";
for (const [key, value] of Object.entries(globalOptions)) {
  if (!(key in paramsOptions))
    globalOptionsStr = globalOptionsStr.concat(
      `| ${key} | ${value.type} | ${value.description} | ${value.default || ""} |\n`
    );
}

generate();

function generate(): void {
  const docsString = `
# Lodestar CLI Documentation
This reference describes the syntax of the Lodestar CLI options and commands.

## Global Options
| Name | Type | Description | Default |
| ----------- | ----------- | ----------- | ----------- |
${globalOptionsStr}

${renderMarkdownSections(
    cmds.map(cmd => cmdToMarkdownSection(cmd))
  )}
`;
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  writeFile("./docs/usage/cli.md", docsString, () => {});
}

function getOptionsTable(options: object): IMarkdownSection[] {
  return Object.entries(options)
    .filter(([, opt]) => !opt.hidden)
    .map(([key, opt]) => {
      // set title to undefined to indicate that this is an option and should not have a title
      return {title: undefined, body: `| ${key} | ${opt.type} | ${opt.description} |`};
    });
}

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
      body: `These are the ${commandJson} command options\n${optionsTableHeader}`,
      subsections: getOptionsTable(cmd.options)
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
 * Render IMarkdownSection recursively tracking its level depth
 */
function renderMarkdownSections(sections: IMarkdownSection[], level = 2): string {
  return sections.map(section => {
    const parts = section.title ? [`${"#".repeat(level)} ${section.title}`] : [""];
    if (section.body) parts.push(section.body);
    if (section.subsections) parts.push(renderMarkdownSections(section.subsections, level + 1));
    return parts.join(section.title ? "\n" : "");
  }).join("\n");
}
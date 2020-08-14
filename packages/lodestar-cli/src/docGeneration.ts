import fs from "fs";
import {cmds} from "./cmds";
import {ICliCommand} from "./util";

interface IMarkdownSection {
  title: string;
  body: string;
  subsections?: IMarkdownSection[];
}

const docsMarkdownPath = process.argv[2];
if (!docsMarkdownPath) throw Error("Run script with output path: 'node docs.js doc.md'");
fs.writeFileSync(docsMarkdownPath, renderMarkdownSections(
  cmds.map(cmd => cmdToMarkdownSection(cmd))
));

/**
 * Parse an ICliCommand type recursively and output a IMarkdownSection
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cmdToMarkdownSection(cmd: ICliCommand<any>, parentCommand?: string): IMarkdownSection {
  const commandJson = [parentCommand, cmd.command.replace("<command>", "")].filter(Boolean).join(" ");
  const section = {
    title: `\`${commandJson}\``, 
    body: cmd.describe,
    subsections: [] as IMarkdownSection[]
  };
  if (cmd.options) {
    section.subsections.push({
      title: `\`${commandJson}\` options`,
      body: `These are the ${commandJson} command options`,
      subsections: Object.entries(cmd.options)
        .filter(([, opt]) => !opt.hidden)
        .map(([key, opt]) => {
          return {title: key, body: opt.description || opt.describe || ""};
        })
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
function renderMarkdownSections(sections: IMarkdownSection[], level = 1): string {
  return sections.map(section => {
    const parts = [`${"#".repeat(level)} ${section.title}`];
    if (section.body) parts.push(section.body);
    if (section.subsections) parts.push(renderMarkdownSections(section.subsections, level + 1));
    return parts.join("\n\n");
  }).join("\n\n\n");
}

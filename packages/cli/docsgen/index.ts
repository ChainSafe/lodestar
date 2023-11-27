import fs from "node:fs";
import path from "node:path";
import {cmds} from "../src/cmds/index.js";
import {globalOptions} from "../src/options/index.js";
import {renderCommandPage} from "./markdown.js";

// Script to generate a reference of all CLI commands and options
// Outputs a markdown format ready to be consumed by mkdocs
//
// Usage:
// ts-node docsgen docs/cli.md
//
// After generation the resulting .md should be mv to the path expected
// by the mkdocs index and other existing paths in the documentation

const dirname = path.dirname(new URL(import.meta.url).pathname);
const LODESTAR_COMMAND = "./lodestar";
const DOCS_PAGES_FOLDER = path.join(dirname, "..", "..", "..", "docs", "pages");

for (const cmd of cmds) {
  const docstring = renderCommandPage(cmd, globalOptions, LODESTAR_COMMAND);
  const folder = path.join(DOCS_PAGES_FOLDER, cmd.docsFolder ?? "");
  // fs.mkdirSync(folder, {recursive: true});
  fs.writeFileSync(path.join(folder, `${cmd.command}-cli.md`), docstring);
}

// /**
//  * Render a Yargs options dictionary to a markdown table
//  */
// function getOptionsTable(
//   options: Record<string, CliOptionDefinition>,
//   {showHidden}: {showHidden?: boolean} = {}
// ): string {
//   const visibleOptions = Object.entries(options).filter(([, opt]) => showHidden || !opt.hidden);

//   if (visibleOptions.length === 0) {
//     return "";
//   }

//   /* eslint-disable @typescript-eslint/naming-convention */
//   return toMarkdownTable(
//     visibleOptions.map(([key, opt]) => ({
//       Option: `\`--${key}\``,
//       Type: opt.type ?? "",
//       Description: opt.description ?? "",
//       Default: String(opt.defaultDescription || opt.default || ""),
//     })),
//     ["Option", "Type", "Description", "Default"]
//   );
// }

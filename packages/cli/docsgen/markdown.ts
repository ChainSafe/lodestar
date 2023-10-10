export type MarkdownSection = {
  title: string;
  body: string | string[];
  subsections?: MarkdownSection[];
};

/**
 * Render MarkdownSection recursively tracking its level depth
 */
export function renderMarkdownSections(sections: MarkdownSection[], level = 1): string {
  return sections
    .map((section) => {
      const parts = section.title ? [`${"\n" + "#".repeat(level)} ${section.title}`] : [""];

      parts.push(Array.isArray(section.body) ? section.body.join("\n\n") : section.body);

      if (section.subsections) {
        parts.push(renderMarkdownSections(section.subsections, level + 1));
      }
      return parts.join(section.title ? "\n" : "");
    })
    .join("\n");
}

/**
 * Render an array of objects as a markdown table
 */
export function toMarkdownTable<T extends {[key: string]: string}>(rows: T[], headers: (keyof T)[]): string {
  return [
    toMarkdownTableRow(headers as string[]),
    toMarkdownTableRow(headers.map(() => "---")),
    ...rows.map((row) => toMarkdownTableRow(headers.map((key) => row[key]))),
  ].join("\n");
}

/**
 * Render an array of items as a markdown table row
 */
export function toMarkdownTableRow(row: string[]): string {
  return `| ${row.join(" | ")} |`;
}

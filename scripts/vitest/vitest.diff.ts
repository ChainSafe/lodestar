import type {DiffOptions} from "vitest";

export default {
  aIndicator: "--",
  bIndicator: "++",
  includeChangeCounts: true,
  contextLines: 2,
  expand: false,
} satisfies DiffOptions;

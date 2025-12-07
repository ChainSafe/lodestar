export type EraOptions = {
  /** Directory containing ERA files to serve historical data from */
  dir: string;
  /** Directory to write archived ERA files to. When set, enables era archiving */
  archiveDir: string;
};

export const defaultEraOptions: EraOptions = {
  dir: "",
  archiveDir: "",
};

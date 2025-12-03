export type EraOptions = {
  /** Directory containing ERA files to serve historical data from */
  dir: string;
};

export const defaultEraOptions: EraOptions = {
  dir: "",
};

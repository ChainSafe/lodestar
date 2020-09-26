export interface IDatabaseOptions {
  name: string;
}

export const defaultDbOptions: IDatabaseOptions = {
  name: "./.tmp/lodestar-db",
};

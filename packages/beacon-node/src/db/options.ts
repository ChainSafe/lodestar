export type DatabaseOptions = {
  name: string;
  saveBlindedBlocks: boolean;
};

export const defaultDbOptions: DatabaseOptions = {
  name: "./.tmp/lodestar-db",
  saveBlindedBlocks: true,
};

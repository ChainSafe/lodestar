export type DatabaseOptions = {
  name: string;
  type: "level" | "lmdb" | "sqlite";
};

export const defaultDbOptions: DatabaseOptions = {
  name: "./.tmp/lodestar-db",
  type: "level",
};

export type DatabaseType = "level" | "lmdb" | "sqlite";

export type DatabaseOptions = {
  name: string;
  type: DatabaseType;
};

export const defaultDbOptions: DatabaseOptions = {
  name: "./.tmp/lodestar-db",
  type: "level",
};

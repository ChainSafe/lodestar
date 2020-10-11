export interface IDatabaseOptions {
  name: string;
}

const config: IDatabaseOptions = {
  name: "./.tmp/lodestar-db",
};

export default config;

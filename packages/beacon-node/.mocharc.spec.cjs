
module.exports = {
  colors: true,
  require: ["./test/setupPreset.ts", "./test/setup.ts"],
  "node-option": [
    "loader=ts-node/esm"
  ],
  timeout: 60_000,
  // Disable parallel locally for easier debugging
  parallel: Boolean(process.env.CI),
  // By default, Mocha’s maximum job count is n – 1, where n is the number of CPU cores
  // In Github actions the runner has only two cores, so force it to use two
  jobs: 2,
};

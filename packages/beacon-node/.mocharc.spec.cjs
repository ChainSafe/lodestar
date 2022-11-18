module.exports = {
  colors: true,
  require: ["./test/setupPreset.ts", "./test/setup.ts"],
  "node-option": ["loader=ts-node/esm"],
  timeout: 60_000,
  // Do not run tests through workers, it's not proven to be faster than with `jobs: 2`
  parallel: false,
};

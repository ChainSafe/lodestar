module.exports = {
  colors: true,
  require: ["./test/setupPreset.ts", "./test/setup.ts"],
  "node-option": ["loader=ts-node/esm"],
  timeout: 60_000,
  parallel: true
};

module.exports = {
  basePath: "",
  frameworks: ["webpack", "mocha", "chai"],
  files: ["test/unit/**/!(*.node).test.ts"],
  exclude: [],
  preprocessors: {
    "test/**/*.ts": ["webpack"],
  },
  reporters: ["spec"],
  browsers: ["ChromeHeadlessCI", "Electron", "FirefoxHeadless"],
  customLaunchers: {
    ChromeHeadlessCI: {
      base: "ChromeHeadless",
      flags: ["--no-sandbox"],
    },
  },
  singleRun: true,
};

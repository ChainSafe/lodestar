module.exports = {
  basePath: "",
  frameworks: ["webpack", "mocha", "chai"],
  files: ["test/unit/**/!(*.node).test.ts"],
  exclude: [],
  preprocessors: {
    "test/**/*.ts": ["webpack"],
  },
  reporters: ["spec"],
  browsers: ["ChromeHeadless", "Electron", "FirefoxHeadless"],
  singleRun: true,
};

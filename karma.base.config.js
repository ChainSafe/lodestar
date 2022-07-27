module.exports = {
  basePath: "",
  frameworks: ["webpack", "mocha", "chai"],
  files: ["test/unit/**/*.test.ts"],
  exclude: [],
  preprocessors: {
    "test/**/*.ts": ["webpack"],
  },
  reporters: ["spec"],
  browsers: ["ChromeHeadless"],
  singleRun: true,
};

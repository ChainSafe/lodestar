// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpackConfig = require("./webpack.config");

module.exports = function(config) {
    config.set({

        basePath: "",
        frameworks: ["mocha", "chai"],
        files: ["test/unit/*.ts"],
        exclude: [],
        preprocessors: {
            "test/**/*.ts": ["webpack"]
        },
        webpack: {
            mode: "production",
            node: webpackConfig.node,
            module: webpackConfig.module,
            resolve: webpackConfig.resolve
        },
        reporters: ["spec"],

        browsers: ["ChromeHeadless"],

        singleRun: true
    });
};
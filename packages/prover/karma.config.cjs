const karmaConfig = require("../../karma.base.config.js");
const webpackConfig = require("./webpack.test.config.cjs");

module.exports = function karmaConfigurator(config) {
  config.set({
    ...karmaConfig,
    webpack: webpackConfig,
  });
};

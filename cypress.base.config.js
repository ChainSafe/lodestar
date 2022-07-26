import {defineConfig} from "cypress";
import webpackPreprocessor from "@cypress/webpack-preprocessor";
import webpackTestConfig from "./webpack.test.config.cjs";

// Patch webpackConfig.output so it returns a `publicPath`, even though output is overwritten in webpackPreprocessor
// Credit: https://github.com/cypress-io/cypress/issues/8900#issuecomment-866897397
// Known Issue: https://github.com/cypress-io/cypress/issues/18435
const publicPath = "";
let outputOptions = {};
Object.defineProperty(webpackTestConfig, "output", {
  get: () => {
    return {...outputOptions, publicPath};
  },
  set: (x) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    outputOptions = x;
  },
});

export default defineConfig({
  env: {
    TESTING_ENV: true,
  },
  screenshotOnRunFailure: false,
  video: false,
  chromeWebSecurity: false,
  e2e: {
    specPattern: "test/unit/**/*.test.ts",
    supportFile: false,
    slowTestThreshold: 10000,
    setupNodeEvents(on, config) {
      on(
        "file:preprocessor",
        webpackPreprocessor({
          webpackOptions: webpackTestConfig,
        })
      );

      on("before:browser:launch", (browser, launchOptions) => {
        return launchOptions;
      });

      // This way we can pass runtime env variables
      // config.env.RUN_TIME_VAR = process.env.RUN_TIME_VAR

      return config;
    },
  },
});

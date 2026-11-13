const path = require("node:path");

module.exports = function versionComparison(context) {
  return {
    name: "lodestar-version-comparison",
    getPathsToWatch() {
      return [
        "versions.json",
        "pages/cli-options.json",
        "pages/run/**/*-cli.md",
        "versioned_docs/**/cli-options.json",
        "versioned_docs/**/*-cli.md",
      ].map((file) => path.join(context.siteDir, file));
    },
    async loadContent() {
      const {loadComparisonData} = await import("./data.mjs");
      return loadComparisonData(context.siteDir);
    },
    async contentLoaded({content, actions}) {
      const dataPath = await actions.createData("cli-comparison.json", JSON.stringify(content));
      actions.addRoute({
        path: `${context.baseUrl}compare`,
        component: "@site/src/components/VersionComparison/index.jsx",
        exact: true,
        modules: {comparisonData: dataPath},
      });
    },
  };
};

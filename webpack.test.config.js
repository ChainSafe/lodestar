const webpack = require("webpack");
const ResolveTypeScriptPlugin = require("resolve-typescript-plugin");

module.exports = {
  mode: "production",
  target: "web",
  experiments: {
    topLevelAwait: true,
  },
  optimization: {
    minimize: false,
  },
  stats: {
    errors: true,
    errorDetails: true,
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: "process/browser.js",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      Buffer: ["buffer", "Buffer"],
    }),
  ],
  module: {
    exprContextCritical: false,
    rules: [
      {
        test: /\.ts?$/,
        use: [
          {
            loader: "ts-loader",
            options: {
              configFile: "tsconfig.e2e.json",
              experimentalFileCaching: true,
              transpileOnly: true,
              projectReferences: true,
            },
          },
        ],
        exclude: [/node_modules/],
      },
    ],
  },
  resolve: {
    plugins: [new ResolveTypeScriptPlugin({includeNodeModules: false})],
    fallback: {
      path: require.resolve("path-browserify"),
      "node:path": require.resolve("path-browserify"),
      http: require.resolve("stream-http"),
      https: require.resolve("https-browserify"),
      stream: require.resolve("stream-browserify"),
      "node:stream": require.resolve("stream-browserify"),
      "@chainsafe/blst": false,
      process: false,
      fs: false,
      os: false,
      zlib: false,
      crypto: false,
      url: false,
    },
    alias: {
      process: "process/browser.js",
    },
    extensions: [".ts", ".js"],
  },
};

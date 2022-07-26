import webpack from "webpack";
import ResolveTypeScriptPlugin from "resolve-typescript-plugin";

export default {
  mode: "development",
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
      http: require.resolve("stream-http"),
      https: require.resolve("https-browserify"),
      "@chainsafe/blst": false,
      fs: false,
      os: false,
      zlib: false,
      stream: false,
      crypto: false,
      url: false,
    },
    extensions: [".ts", ".js"],
  },
};

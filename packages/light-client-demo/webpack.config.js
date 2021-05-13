const {resolve} = require("path");
const {ProvidePlugin} = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserWebpackPlugin = require("terser-webpack-plugin");

const isProd = process.env.NODE_ENV === "production";

const config = {
  mode: isProd ? "production" : "development",
  entry: {
    index: "./src/index.tsx",
  },
  output: {
    path: resolve(__dirname, "dist"),
    filename: "[name].js",
  },
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
    fallback: {
      fs: false,
      stream: false,
      crypto: false,
      os: false,
      https: false,
      http: false,
      zlib: false,
      path: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.scss$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: "css-loader",
          },
          {
            loader: "sass-loader",
            options: {
              sourceMap: true,
            },
          },
        ],
      },
      {
        test: /\.tsx?$/,
        use: "babel-loader",
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: "css/[name].bundle.css",
    }),
    new HtmlWebpackPlugin({
      title: "Lightclient demo | Chainsafe Systems",
      template: "src/index.html",
    }),
    new ProvidePlugin({
      process: "process/browser.js",
      Buffer: ["buffer", "Buffer"],
    }),
  ],
};

if (isProd) {
  config.optimization = {
    minimizer: [new TerserWebpackPlugin()],
  };
} else {
  config.devServer = {
    port: 8080, // https://webpack.js.org/configuration/dev-server/#devserverport
    open: true, // https://webpack.js.org/configuration/dev-server/#devserveropen
    hot: true, // https://webpack.js.org/configuration/dev-server/#devserverhot
    compress: true, // https://webpack.js.org/configuration/dev-server/#devservercompress
    stats: "errors-only", // https://webpack.js.org/configuration/dev-server/#devserverstats-
    overlay: true, // https://webpack.js.org/configuration/dev-server/#devserveroverlay
  };
}

module.exports = config;

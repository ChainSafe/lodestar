/* eslint-disable import/no-extraneous-dependencies */
import path from "path";
import {Configuration as WebpackConfiguration} from "webpack";
import {Configuration as WebpackDevServerConfiguration} from "webpack-dev-server";

// Type issue, see https://github.com/DefinitelyTyped/DefinitelyTyped/issues/27570
interface IConfiguration extends WebpackConfiguration {
  devServer?: WebpackDevServerConfiguration;
}

const config: IConfiguration = {
  entry: "./src/index.tsx",
  module: {
    rules: [
      {
        test: /\.(ts|js)x?$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env", "@babel/preset-react", "@babel/preset-typescript"],
          },
        },
      },
      {
        test: /\.scss$/,
        use: [
          // Translates CSS into CommonJS
          "css-loader",
          // Compiles Sass to CSS
          "sass-loader",
        ],
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
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
  output: {
    path: path.resolve(__dirname, "build"),
    filename: "bundle.js",
  },
  devServer: {
    contentBase: path.join(__dirname, "build"),
    compress: true,
    port: 4000,
  },
};

export default config;

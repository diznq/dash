const path = require('path');
const webpack = require("webpack");
module.exports = {
  mode: 'production',
  entry: {
    "app": path.join(__dirname, "www", "js", "app.js")
  },
  watch: true,
  output: {
    path: path.join(__dirname, 'www/js/rel/'),
    publicPath: '/www/js/rel/',
    filename: "[name].js",
    chunkFilename: '[name].js'
  },
  module: {
    rules: [{
      test: /.jsx?$/,
      include: [
        path.resolve(__dirname, 'app')
      ],
      exclude: [
        path.resolve(__dirname, 'node_modules')
      ]
    },
    {
      test: /\.js$/, //Regular expression 
      exclude: /(node_modules)/
     }]
  },
  resolve: {
    extensions: ['.json', '.js', '.jsx'],
  },
  plugins: [],
  devtool: 'source-map',
  devServer: {
    contentBase: path.join(__dirname, '/dist/'),
    inline: true,
    host: 'localhost',
    port: 8080,
  }
};
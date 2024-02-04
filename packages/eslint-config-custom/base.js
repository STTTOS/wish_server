const path = require("path");

const project = path.resolve(process.cwd(), "tsconfig.json");

module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/eslint-recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project,
  },
  plugins: ["@typescript-eslint"],
  rules: {
    "no-unused-vars": "error",
    "@typescript-eslint/no-unused-vars": "error",
    indent: ["error", 2],
    "linebreak-style": ["error", "unix"],
    quotes: ["error", "single"],
    semi: ["error", "never"],
    "no-else-return": "error",
    "comma-spacing": "error",
    "object-curly-spacing": ["error", "always"],
    "@typescript-eslint/no-non-null-assertion": "off",
    "no-console": "warn",
    "no-const-assign": "error",
    "no-constant-condition": "error",
    "no-empty": "warn",
    "no-func-assign": "error",
    "no-inline-comments": "error",
    "no-lonely-if": "error",
    "no-multi-spaces": "error",
    "no-trailing-spaces": "error",
    camelcase: "error",
    "no-dupe-keys": "error",
    "no-nested-ternary": "error",
    "no-param-reassign": "error",
    "no-self-compare": "error",
    "no-unneeded-ternary": "error",
    "comma-dangle": ["error", "never"],
    "arrow-spacing": "error",
    "arrow-parens": "error",
    // 立即执行函数风格
    "wrap-iife": ["error", "inside"],
    "key-spacing": [
      "error",
      {
        afterColon: true,
      },
    ],
  },
};

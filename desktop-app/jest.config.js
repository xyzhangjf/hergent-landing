/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.js"],

  // Electron 主进程模块需要在 Node 环境下 mock
  moduleNameMapper: {
    "^electron$": "<rootDir>/tests/__mocks__/electron.js",
  },

  // 超时设置（部分测试可能涉及异步等待）
  testTimeout: 10000,

  // 覆盖率配置
  collectCoverageFrom: [
    "src/main/**/*.js",
    "src/renderer/**/*.js",
    "!src/main/role-skills.js",
    "!src/main/roles-data.js",
  ],
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text", "lcov"],
};

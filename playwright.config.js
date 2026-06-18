const { defineConfig, devices } = require("@playwright/test");

const chromeBeta = "C:/Program Files/Google/Chrome Beta/Application/chrome.exe";

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.03
    }
  },
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    launchOptions: {
      executablePath: chromeBeta
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"]
      }
    }
  ]
});

import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "stockpilot-e2e-"));
const hostedDemo = process.env.STOCKPILOT_HOSTED_DEMO_TEST === "1";
export default defineConfig({
  testDir: "./tests",
  testIgnore:
    process.env.STOCKPILOT_OFFLINE_TEST === "1" || hostedDemo
      ? ["**/market.spec.js"]
      : [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: hostedDemo ? "http://127.0.0.1:8013" : "http://127.0.0.1:8010",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer:
    hostedDemo
      ? {
          command: "python3 ../scripts/serve-vercel-demo.py",
          url: "http://127.0.0.1:8013",
          reuseExistingServer: false,
        }
      : process.env.STOCKPILOT_OFFLINE_TEST === "1"
      ? {
          command:
            "python3 -m http.server 8012 --bind 127.0.0.1 --directory ../releases",
          url: "http://127.0.0.1:8012",
          reuseExistingServer: false,
        }
      : {
          command:
            "../.venv/bin/uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8010",
          env: {
            STOCKPILOT_DB: join(directory, "e2e.db"),
            STOCKPILOT_MARKET_MODE: "demo",
          },
          url: "http://127.0.0.1:8010/api/health",
          reuseExistingServer: false,
        },
});

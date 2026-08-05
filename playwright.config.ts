import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Each test does real bcrypt hashing and real Postgres writes (no mocking in
  // e2e, by design), plus Turbopack cold-compiles each route on first hit. This
  // sandbox's CPU can't sustain 6-way concurrency of that within default
  // assertion timeouts — a beefier CI runner can safely raise this.
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

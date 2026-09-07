import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests', fullyParallel:false, workers:1,
  use:{baseURL:'http://127.0.0.1:4173',channel:'chrome',headless:true,trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:false,env:{VITE_API_URL:'http://127.0.0.1:4173'}},
});

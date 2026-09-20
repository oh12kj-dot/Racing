import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
  testDir:'./iphone-demo/tests',
  timeout:90000,
  expect:{timeout:12000},
  fullyParallel:false,
  workers:1,
  reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report'}]],
  use:{
    baseURL:'http://127.0.0.1:4173',
    trace:'retain-on-failure',
    screenshot:'only-on-failure',
    video:'retain-on-failure'
  },
  projects:[
    {name:'chromium',testIgnore:['**/ios-runtime.spec.mjs'],use:{...devices['Desktop Chrome'],viewport:{width:1280,height:720}}},
    {name:'iphone-webkit',testMatch:['**/ios-runtime.spec.mjs'],use:{...devices['iPhone 13']}}
  ],
  webServer:{command:'python3 -m http.server 4173 --bind 127.0.0.1',url:'http://127.0.0.1:4173/iphone-demo/index.html',reuseExistingServer:true,timeout:15000}
});

import {test,expect} from '@playwright/test';
import {RADIO_SPEECH_RATE,applyNaturalRadioRate} from '../../iphone-demo/runtime/audio-silent-policy.js';

test('radio speech uses a natural brisk cadence without changing silent priming',()=>{
  const driver={rate:.98,pitch:.97},engineer={rate:1,pitch:.91},prime={rate:2,pitch:1};
  applyNaturalRadioRate(driver);applyNaturalRadioRate(engineer);applyNaturalRadioRate(prime);
  expect(RADIO_SPEECH_RATE.driver).toBeCloseTo(1.08,2);
  expect(RADIO_SPEECH_RATE.engineer).toBeCloseTo(1.12,2);
  expect(driver.rate).toBeCloseTo(1.08,2);
  expect(engineer.rate).toBeCloseTo(1.12,2);
  expect(prime.rate).toBe(2);
});

test('runtime exposes the radio cadence profile',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_AUDIO__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const r=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||'',profile:window.__RACING_AUDIO__?.speechProfile||null}));
  expect(r.status,r.error||'runtime boot status').not.toBe('ERROR');
  expect(r.profile?.owner).toBe('runtime-natural-radio-v1');
  expect(r.profile?.driverRate).toBeCloseTo(1.08,2);
  expect(r.profile?.engineerRate).toBeCloseTo(1.12,2);
  expect(r.profile?.primeRate).toBe(2);
});

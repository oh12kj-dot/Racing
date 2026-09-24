import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__&&!!window.__RACING_LIFECYCLE__&&document.querySelectorAll('.lb-row').length===24);
  await page.evaluate(()=>window.__RACING_LIFECYCLE__.pauseForTest());
}

test('ENERGY-UI-01: tracked hybrid exposes SOC, policy and physical flow separately',async({page})=>{
  await boot(page);
  const expected=await page.evaluate(()=>{
    const car=window.__RACING_RACE__.cars.find(c=>(c.systems?.energyCapacityMJ||0)>0);
    const s=car.systems;
    s.energyMJ=s.energyCapacityMJ*.43;
    s.energyPolicyMode='CAUTION_SAVE';
    s.energyMode='HARVEST';
    s.energyDeploy=.21;
    s.energyHarvest=.67;
    return{carId:car.id,soc:43,policy:s.energyPolicyMode,flow:s.energyMode,deploy:21,regen:67};
  });

  await page.locator(`.lb-row[data-id="${expected.carId}"]`).click();
  const energy=page.locator('#telemetry .energy-telemetry');
  await expect(energy).toHaveCount(1);
  await expect(energy).toHaveAttribute('data-energy-policy',expected.policy);
  await expect(energy).toHaveAttribute('data-energy-flow',expected.flow);
  await expect(energy).toContainText(`ERS ${expected.soc}%`);
  await expect(energy).toContainText(`POLICY ${expected.policy}`);
  await expect(energy).toContainText(`FLOW ${expected.flow}`);
  await expect(energy).toContainText(`DEPLOY ${expected.deploy}%`);
  await expect(energy).toContainText(`REGEN ${expected.regen}%`);
});

test('ENERGY-UI-02: non-hybrid tracked cars do not show an irrelevant ERS row',async({page})=>{
  await boot(page);
  const carId=await page.evaluate(()=>window.__RACING_RACE__.cars.find(c=>(c.systems?.energyCapacityMJ||0)<=0).id);
  await page.locator(`.lb-row[data-id="${carId}"]`).click();
  await expect(page.locator('#telemetry .energy-telemetry')).toHaveCount(0);
  await expect(page.locator('#telemetry')).not.toContainText('ERS ');
});

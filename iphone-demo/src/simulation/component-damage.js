const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const AERO_DAMAGE_EFFECT_THRESHOLD=.15;
export const POWERTRAIN_DAMAGE_EFFECT_THRESHOLD=.15;

export const COMPONENT_DAMAGE_KEYS=Object.freeze(['aero','powertrain','steering','brakes']);

export function createComponentDamage(){
  return{aero:0,powertrain:0,steering:0,brakes:0};
}

export function ensureComponentDamage(incident){
  if(!incident.componentDamage)incident.componentDamage=createComponentDamage();
  for(const key of COMPONENT_DAMAGE_KEYS){
    incident.componentDamage[key]=clamp(Number(incident.componentDamage[key])||0,0,1);
  }
  return incident.componentDamage;
}

export function applyImpactComponentDamage(incident,deltaV,contact,response){
  if(!incident)return 0;
  const severity=Math.max(0,(Number(deltaV)||0)-1.5)*.010;
  if(severity<=0)return 0;

  // Preserve the legacy aggregate contract exactly: once contact resolution has
  // been applied, aggregate damage is derived from delta-V even when the
  // response contains separation correction rather than genuine impact impulse.
  incident.damage=clamp((Number(incident.damage)||0)+severity,0,1);

  // Detailed component state is stricter than the legacy aggregate. Pure
  // separation correction must never manufacture directional component damage.
  if(!(response?.impactImpulse>0)||!(response?.impactSpeed>0))return 0;

  const damage=ensureComponentDamage(incident);
  const longitudinal=clamp(Math.abs(contact?.normalLong??response?.normalLong??0),0,1);
  const lateral=clamp(Math.abs(contact?.normalLat??response?.normalLat??0),0,1);

  // Deterministic directional allocation from genuine collision impulse only.
  // Longitudinal impacts primarily hurt body/aero and powertrain; lateral
  // impacts primarily hurt steering/suspension and brakes.
  damage.aero=clamp(damage.aero+severity*(.80*longitudinal+.18*lateral),0,1);
  damage.powertrain=clamp(damage.powertrain+severity*(.62*longitudinal+.10*lateral),0,1);
  damage.steering=clamp(damage.steering+severity*(.12*longitudinal+.82*lateral),0,1);
  damage.brakes=clamp(damage.brakes+severity*(.18*longitudinal+.45*lateral),0,1);
  return severity;
}

export function powertrainDamageExcess(incident={}){
  const damage=clamp(Number(incident.componentDamage?.powertrain)||0,0,1);
  return Math.max(0,damage-POWERTRAIN_DAMAGE_EFFECT_THRESHOLD);
}

export function componentPerformanceFactors(incident={}){
  const legacy=clamp(Number(incident.damage)||0,0,1);
  const aeroDamage=clamp(Number(incident.componentDamage?.aero)||0,0,1);

  // Keep the proven aggregate aero envelope for routine contact. Component-
  // specific aero becomes an additional degradation only after material aero
  // damage has accumulated, preventing small direction changes from reshaping
  // the whole race while still making severe front/body damage distinct.
  const aeroExcess=Math.max(0,aeroDamage-AERO_DAMAGE_EFFECT_THRESHOLD);
  const legacyAero=clamp(1-legacy*.32,.68,1);
  const legacyDrag=1+legacy*.22;
  const aero=clamp(legacyAero-aeroExcess*.30,.55,1);
  const drag=legacyDrag+aeroExcess*.18;

  // Powertrain follows the same staged compatibility rule. Routine contact keeps
  // the calibrated aggregate drive envelope; material component damage adds a
  // monotonic loss without directly changing failure state or top-speed authority.
  const legacyDrive=clamp(1-legacy*.22,.35,1);
  const drive=clamp(legacyDrive-powertrainDamageExcess(incident)*.22,.30,1);

  // Remaining channels stay on the proven aggregate envelope until introduced
  // one at a time with dedicated long-run regression coverage.
  return{
    aero,
    drive,
    steering:clamp(1-legacy*.28,.65,1),
    brake:1,
    top:clamp(1-legacy*.10,.78,1),
    drag
  };
}

export function componentDamageHashValues(incident={}){
  const damage=incident.componentDamage||createComponentDamage();
  return COMPONENT_DAMAGE_KEYS.map(key=>Math.round(clamp(Number(damage[key])||0,0,1)*1e6));
}

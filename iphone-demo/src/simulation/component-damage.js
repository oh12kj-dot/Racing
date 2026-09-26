const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

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

export function componentPerformanceFactors(incident={}){
  const legacy=clamp(Number(incident.damage)||0,0,1);
  // Detailed component state is authoritative for damage identity and hashing,
  // but remains performance-neutral in this foundation step. Keep the proven
  // aggregate envelope unchanged while component channels are introduced and
  // validated individually in later work.
  return{
    aero:clamp(1-legacy*.32,.68,1),
    drive:clamp(1-legacy*.22,.35,1),
    steering:clamp(1-legacy*.28,.65,1),
    brake:1,
    top:clamp(1-legacy*.10,.78,1),
    drag:1+legacy*.22
  };
}

export function componentDamageHashValues(incident={}){
  const damage=incident.componentDamage||createComponentDamage();
  return COMPONENT_DAMAGE_KEYS.map(key=>Math.round(clamp(Number(damage[key])||0,0,1)*1e6));
}

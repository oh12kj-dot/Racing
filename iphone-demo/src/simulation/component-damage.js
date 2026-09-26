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
  if(!incident||!(response?.impactImpulse>0)||!(response?.impactSpeed>0))return 0;
  const severity=Math.max(0,(Number(deltaV)||0)-1.5)*.010;
  if(severity<=0)return 0;

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

  // Preserve the legacy aggregate contract while detailed consumers migrate.
  incident.damage=clamp((Number(incident.damage)||0)+severity,0,1);
  return severity;
}

export function componentPerformanceFactors(incident={}){
  const legacy=clamp(Number(incident.damage)||0,0,1);
  const raw=incident.componentDamage;
  const hasDetailed=!!raw&&COMPONENT_DAMAGE_KEYS.some(key=>(Number(raw[key])||0)>1e-9);

  if(!hasDetailed){
    return{
      aero:clamp(1-legacy*.32,.68,1),
      drive:clamp(1-legacy*.22,.35,1),
      steering:clamp(1-legacy*.28,.65,1),
      brake:clamp(1-legacy*.18,.68,1),
      top:clamp(1-legacy*.10,.78,1),
      drag:1+legacy*.22
    };
  }

  const aero=clamp(Number(raw.aero)||0,0,1);
  const powertrain=clamp(Number(raw.powertrain)||0,0,1);
  const steering=clamp(Number(raw.steering)||0,0,1);
  const brakes=clamp(Number(raw.brakes)||0,0,1);
  return{
    aero:clamp(1-aero*.38,.62,1),
    drive:clamp(1-powertrain*.34,.50,1),
    steering:clamp(1-steering*.42,.58,1),
    brake:clamp(1-brakes*.35,.60,1),
    top:clamp(1-aero*.08-powertrain*.08,.78,1),
    drag:1+aero*.28
  };
}

export function componentDamageHashValues(incident={}){
  const damage=incident.componentDamage||createComponentDamage();
  return COMPONENT_DAMAGE_KEYS.map(key=>Math.round(clamp(Number(damage[key])||0,0,1)*1e6));
}

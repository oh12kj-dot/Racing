const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smoothstep=(a,b,v)=>{const t=clamp((v-a)/Math.max(.0001,b-a),0,1);return t*t*(3-2*t);};

export const DAMAGE_THRESHOLDS=Object.freeze({
  degradedSuspension:.18,
  serviceSuspension:.38,
  severeSuspension:.72,
  heavyAggregate:.68,
  retirementAggregate:.90
});

/**
 * Converts component damage into continuous vehicle capability loss.
 *
 * Aggregate body damage is deliberately not translated into an absolute speed
 * cap. Front/rear aero loss is already represented by aeroFront/aeroRear in the
 * racing envelope. Suspension damage instead degrades the capabilities it
 * physically affects: stability/grip, braking, acceleration and the safe usable
 * speed range. This keeps a damaged Formula/Prototype/GT car distinct rather
 * than forcing every class to the same magic km/h value.
 */
export function damagePerformance(car={}){
  const z=car.damageZones||{};
  const suspension=clamp(Number(z.suspension)||0,0,1);
  const aggregate=clamp(Number(car.damage)||0,0,1);
  const severity=smoothstep(DAMAGE_THRESHOLDS.degradedSuspension,.90,suspension);

  return Object.freeze({
    aggregate,
    suspension,
    severity,
    topSpeedScale:1-.64*severity,
    accelerationScale:1-.55*severity,
    brakeScale:1-.45*severity,
    lateralGripScale:1-.58*severity,
    degradedSuspension:suspension>=DAMAGE_THRESHOLDS.degradedSuspension,
    serviceSuspension:suspension>=DAMAGE_THRESHOLDS.serviceSuspension,
    severeSuspension:suspension>=DAMAGE_THRESHOLDS.severeSuspension,
    heavyAggregate:aggregate>=DAMAGE_THRESHOLDS.heavyAggregate,
    retireFromAggregate:aggregate>=DAMAGE_THRESHOLDS.retirementAggregate
  });
}

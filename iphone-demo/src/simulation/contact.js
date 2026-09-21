const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function contactManifold(a,b,track){
  const longitudinal=track.signedDistance(a.s,b.s);
  const lateral=(b.lane||0)-(a.lane||0);
  const long=Math.abs(longitudinal),lat=Math.abs(lateral);

  // Rounded-rectangle/capsule approximation in track coordinates. The straight
  // core preserves full vehicle length while rounded end caps avoid AABB-only
  // corner contacts when two cars have genuine diagonal clearance.
  const radius=Math.max(.4,(a.width+b.width)*.49);
  const coreA=Math.max(0,(a.length-a.width)*.5);
  const coreB=Math.max(0,(b.length-b.width)*.5);
  const longitudinalCore=coreA+coreB;
  const capDx=Math.max(0,long-longitudinalCore);
  const separation=Math.hypot(capDx,lat);
  const penetration=radius-separation;

  let normalLong=0,normalLat=0;
  if(capDx>1e-6){
    const nx=Math.sign(longitudinal||1)*capDx;
    const ny=lateral;
    const nLen=Math.hypot(nx,ny)||1;
    normalLong=nx/nLen;normalLat=ny/nLen;
  }else{
    const relLong=(b.v||0)-(a.v||0);
    const relLat=(b.laneV||0)-(a.laneV||0);
    const longitudinalClosing=long>.25&&Math.abs(relLong)>Math.abs(relLat)*1.5;
    const nearlyAligned=long>.25&&lat<radius*.18;
    if(longitudinalClosing||nearlyAligned){
      normalLong=Math.sign(longitudinal||1);
    }else if(lat>1e-6){
      normalLat=Math.sign(lateral);
    }else if(long>.25){
      normalLong=Math.sign(longitudinal);
    }else{
      normalLat=a.id<=b.id?1:-1;
    }
  }

  return{
    hit:penetration>0,
    longitudinal,
    lateral,
    long,
    lat,
    radius,
    longitudinalCore,
    separation,
    penetration:Math.max(0,penetration),
    lateralPenetration:Math.max(0,radius-lat),
    proximity:clamp(1-separation/Math.max(.001,radius),0,1),
    normalLong,
    normalLat
  };
}

export function resolveContactImpulse(a,b,contact,options={}){
  if(!contact?.hit)return{applied:false,impactSpeed:0,impulse:0,impactImpulse:0,deltaVA:0,deltaVB:0,deltaYawRateA:0,deltaYawRateB:0};
  const massA=Math.max(1,a.mass||a.spec?.mass||1000),massB=Math.max(1,b.mass||b.spec?.mass||1000);
  const invA=1/massA,invB=1/massB,invMass=invA+invB;
  const nLong=contact.normalLong||0,nLat=contact.normalLat||0;
  const relLong=(b.v||0)-(a.v||0),relLat=(b.laneV||0)-(a.laneV||0);
  const relativeNormal=relLong*nLong+relLat*nLat;
  const impactSpeed=Math.max(0,-relativeNormal);
  const restitution=clamp(options.restitution??.06,0,.25);

  // Collision and overlap correction are deliberately separated. The contact
  // impulse changes linear momentum; Baumgarte separation only prevents bodies
  // remaining interpenetrated and must never create crash yaw/damage by itself.
  const separationTarget=Math.min(options.maxSeparationSpeed??1.8,(contact.penetration||0)*(options.separationGain??2.6));
  const reboundTarget=impactSpeed*restitution;
  const desiredNormal=Math.max(separationTarget,reboundTarget);
  const deltaNormal=Math.max(0,desiredNormal-relativeNormal);
  if(deltaNormal<=1e-8)return{applied:false,impactSpeed,impulse:0,impactImpulse:0,deltaVA:0,deltaVB:0,deltaYawRateA:0,deltaYawRateB:0,relativeNormal};
  const impulse=deltaNormal/invMass;
  const impactImpulse=impactSpeed>0?impactSpeed*(1+restitution)/invMass:0;

  const beforeA=a.v||0,beforeB=b.v||0,beforeLatA=a.laneV||0,beforeLatB=b.laneV||0;
  const beforeYawA=a.yawRate||0,beforeYawB=b.yawRate||0;
  a.v=Math.max(0,beforeA-impulse*nLong*invA);
  b.v=Math.max(0,beforeB+impulse*nLong*invB);
  a.laneV=beforeLatA-impulse*nLat*invA;
  b.laneV=beforeLatB+impulse*nLat*invB;

  // Only the genuine collision impulse can create angular momentum. A pure
  // overlap/separation correction has impactImpulse=0 and therefore no yaw kick.
  const lengthA=Math.max(1,a.length||a.spec?.length||4.5),lengthB=Math.max(1,b.length||b.spec?.length||4.5);
  const widthA=Math.max(.8,a.width||a.spec?.width||2),widthB=Math.max(.8,b.width||b.spec?.width||2);
  const inertiaA=massA*(lengthA*lengthA+widthA*widthA)/12;
  const inertiaB=massB*(lengthB*lengthB+widthB*widthB)/12;
  const leverA=clamp((contact.longitudinal||0)*.5,-lengthA*.5,lengthA*.5);
  const leverB=clamp(-(contact.longitudinal||0)*.5,-lengthB*.5,lengthB*.5);
  const lateralImpactImpulse=impactImpulse*nLat;
  const maxYawKick=Math.max(.5,options.maxYawKick??4.5);
  const rawYawA=leverA*(-lateralImpactImpulse)/Math.max(1,inertiaA);
  const rawYawB=leverB*( lateralImpactImpulse)/Math.max(1,inertiaB);
  const yawKickA=clamp(rawYawA,-maxYawKick,maxYawKick);
  const yawKickB=clamp(rawYawB,-maxYawKick,maxYawKick);
  a.yawRate=clamp(beforeYawA+yawKickA,-6,6);
  b.yawRate=clamp(beforeYawB+yawKickB,-6,6);

  return{
    applied:true,
    impactSpeed,
    impulse,
    impactImpulse,
    separationImpulse:Math.max(0,impulse-impactImpulse),
    relativeNormal,
    normalLong:nLong,
    normalLat:nLat,
    deltaVA:a.v-beforeA,
    deltaVB:b.v-beforeB,
    deltaLatA:a.laneV-beforeLatA,
    deltaLatB:b.laneV-beforeLatB,
    deltaYawRateA:a.yawRate-beforeYawA,
    deltaYawRateB:b.yawRate-beforeYawB
  };
}

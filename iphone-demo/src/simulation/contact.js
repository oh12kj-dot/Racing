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
  if(capDx>1e-6||lat>1e-6){
    const nx=Math.sign(longitudinal||1)*capDx;
    const ny=lateral;
    const nLen=Math.hypot(nx,ny)||1;
    normalLong=nx/nLen;normalLat=ny/nLen;
  }else if(Math.abs(longitudinal)>.25){
    normalLong=Math.sign(longitudinal);
  }else{
    normalLat=a.id<=b.id?1:-1;
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
  if(!contact?.hit)return{applied:false,impactSpeed:0,impulse:0,deltaVA:0,deltaVB:0};
  const massA=Math.max(1,a.mass||a.spec?.mass||1000),massB=Math.max(1,b.mass||b.spec?.mass||1000);
  const invA=1/massA,invB=1/massB;
  const nLong=contact.normalLong||0,nLat=contact.normalLat||0;
  const relLong=(b.v||0)-(a.v||0),relLat=(b.laneV||0)-(a.laneV||0);
  const relativeNormal=relLong*nLong+relLat*nLat;
  const impactSpeed=Math.max(0,-relativeNormal);
  const restitution=clamp(options.restitution??.06,0,.25);

  // A small Baumgarte-style separation velocity prevents persistent overlap
  // without ever rewriting position/pose. It is capped so deep test fixtures do
  // not create an artificial launch.
  const separationTarget=Math.min(options.maxSeparationSpeed??1.8,(contact.penetration||0)*(options.separationGain??2.6));
  const neededDelta=Math.max(0,separationTarget-relativeNormal);
  if(neededDelta<=1e-8)return{applied:false,impactSpeed,impulse:0,deltaVA:0,deltaVB:0,relativeNormal};
  const bounce=impactSpeed*restitution;
  const impulse=(neededDelta+bounce)/(invA+invB);

  const beforeA=a.v||0,beforeB=b.v||0,beforeLatA=a.laneV||0,beforeLatB=b.laneV||0;
  a.v=Math.max(0,beforeA-impulse*nLong*invA);
  b.v=Math.max(0,beforeB+impulse*nLong*invB);
  a.laneV=beforeLatA-impulse*nLat*invA;
  b.laneV=beforeLatB+impulse*nLat*invB;

  return{
    applied:true,
    impactSpeed,
    impulse,
    relativeNormal,
    normalLong:nLong,
    normalLat:nLat,
    deltaVA:a.v-beforeA,
    deltaVB:b.v-beforeB,
    deltaLatA:a.laneV-beforeLatA,
    deltaLatB:b.laneV-beforeLatB
  };
}

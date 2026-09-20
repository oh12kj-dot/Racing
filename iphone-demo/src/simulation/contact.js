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
    proximity:clamp(1-separation/Math.max(.001,radius),0,1)
  };
}

const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function rawPoint(t){
  const rx=190+18*Math.cos(t*3);
  const rz=122+10*Math.sin(t*2);
  return{x:rx*Math.cos(t),z:rz*Math.sin(t)};
}
function heading(a,b){return Math.atan2(b.x-a.x,b.z-a.z);}
function wrapAngle(a){return((a+Math.PI)%TAU+TAU)%TAU-Math.PI;}

export function createTrack(){
  const count=2048;
  const pts=Array.from({length:count},(_,i)=>rawPoint(i/count*TAU));
  const cumulative=[0];
  for(let i=1;i<=count;i++){
    const a=pts[i-1],b=pts[i%count];
    cumulative[i]=cumulative[i-1]+Math.hypot(b.x-a.x,b.z-a.z);
  }
  const total=cumulative[count];
  const sectors=[total/3,total*2/3];
  const curv=new Float64Array(count);
  for(let i=0;i<count;i++){
    const p0=pts[(i-2+count)%count],p1=pts[i],p2=pts[(i+2)%count];
    const h0=heading(p0,p1),h1=heading(p1,p2);
    const ds=Math.max(.1,Math.hypot(p2.x-p0.x,p2.z-p0.z)*.5);
    curv[i]=wrapAngle(h1-h0)/ds;
  }
  const pit={
    entryStart:total*.73,
    speedLine:total*.78,
    boxStart:total*.835,
    boxSpacing:5.8,
    exitStart:total*.915,
    mergeStart:total*.94,
    mergeEnd:total*.985,
    limiterEnd:total*.958,
    fastLane:-10.5,
    workingLane:-13.5,
    approachLane:-2.7,
    speedLimit:22.22
  };
  function wrapS(s){return((s%total)+total)%total;}
  function indexForS(s){
    const x=wrapS(s);
    let lo=0,hi=count;
    while(lo+1<hi){const m=(lo+hi)>>1;(cumulative[m]<=x?lo=m:hi=m);}
    return lo%count;
  }
  function sample(s,lateral=0){
    const x=wrapS(s),i=indexForS(x),j=(i+1)%count;
    const segStart=cumulative[i],segEnd=i===count-1?total:cumulative[i+1];
    const u=clamp((x-segStart)/Math.max(.001,segEnd-segStart),0,1);
    const a=pts[i],b=pts[j];
    const px=a.x+(b.x-a.x)*u,pz=a.z+(b.z-a.z)*u;
    const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
    const tx=dx/len,tz=dz/len;
    const nx=-tz,nz=tx;
    return{x:px+nx*lateral,z:pz+nz*lateral,tx,tz,nx,nz,heading:Math.atan2(tx,tz),curvature:curv[i],halfWidth:7.5,s:x};
  }
  function curvature(s){return curv[indexForS(s)];}
  function idealLane(s){
    const k0=curvature(s),ka=curvature(s+35),kb=curvature(s-30);
    return clamp((k0*150-ka*48-kb*30),-2.25,2.25);
  }
  function forwardDistance(a,b){return((wrapS(b)-wrapS(a))+total)%total;}
  function signedDistance(a,b){
    let d=wrapS(b)-wrapS(a);
    if(d>total*.5)d-=total;if(d<-total*.5)d+=total;
    return d;
  }
  function worldToTrack(x,z){
    let bestI=0,bestD=Infinity;
    for(let i=0;i<count;i+=4){
      const p=pts[i],d=(x-p.x)**2+(z-p.z)**2;
      if(d<bestD){bestD=d;bestI=i;}
    }
    let best={d:Infinity,s:0,lateral:0};
    for(let di=-6;di<=6;di++){
      const i=(bestI+di+count)%count,j=(i+1)%count;
      const a=pts[i],b=pts[j],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz||1;
      const u=clamp(((x-a.x)*dx+(z-a.z)*dz)/l2,0,1);
      const px=a.x+dx*u,pz=a.z+dz*u;
      const dd=(x-px)**2+(z-pz)**2;
      if(dd<best.d){
        const len=Math.sqrt(l2),nx=-dz/len,nz=dx/len;
        const segStart=cumulative[i],segEnd=i===count-1?total:cumulative[i+1];
        best={d:dd,s:wrapS(segStart+(segEnd-segStart)*u),lateral:(x-px)*nx+(z-pz)*nz};
      }
    }
    return{s:best.s,lateral:best.lateral,error:Math.sqrt(best.d)};
  }
  return{total,count,pit,sectors,wrapS,sample,curvature,idealLane,forwardDistance,signedDistance,worldToTrack};
}

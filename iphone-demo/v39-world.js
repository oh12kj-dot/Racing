import {buildWorld as buildV38World} from './v38-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV38World(THREE,TRACK,settings,circuitName),total=W.total,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const count=Math.max(900,Math.min(1500,Math.round(total/4.2))),step=total/count,curv=new Float32Array(count),smooth=new Float32Array(count),line=new Float32Array(count);
  const wrapIndex=i=>(i%count+count)%count,field=(arr,s)=>{const u=((((s%total)+total)%total)/total)*count,i=Math.floor(u),f=u-i;return arr[wrapIndex(i)]*(1-f)+arr[wrapIndex(i+1)]*f;};

  // Signed geometric curvature in 1/metre. Positive lane is the inside of a positive (left) turn.
  for(let i=0;i<count;i++){
    const s=i*step,a=W.sample(s-7),b=W.sample(s+7),dot=clamp(a.t.x*b.t.x+a.t.z*b.t.z,-1,1),cross=a.t.x*b.t.z-a.t.z*b.t.x;
    curv[i]=Math.atan2(cross,dot)/14;
  }
  // Circular low-pass removes spline micro-noise without moving the actual apex locations.
  for(let i=0;i<count;i++)smooth[i]=curv[wrapIndex(i-2)]*.08+curv[wrapIndex(i-1)]*.18+curv[i]*.48+curv[wrapIndex(i+1)]*.18+curv[wrapIndex(i+2)]*.08;

  // Detect geometric apexes, consolidating only same-direction peaks that are very close.
  const apex=[];
  for(let i=0;i<count;i++){
    const a=Math.abs(smooth[i]);if(a<.0022)continue;
    let peak=true;for(let d=1;d<=3;d++)if(Math.abs(smooth[wrapIndex(i-d)])>a||Math.abs(smooth[wrapIndex(i+d)])>a){peak=false;break;}
    if(!peak)continue;
    const item={i,s:i*step,k:smooth[i],strength:clamp(a*62,0,1)};
    const prev=apex[apex.length-1];if(prev&&item.s-prev.s<42&&Math.sign(prev.k)===Math.sign(item.k)){if(a>Math.abs(prev.k))apex[apex.length-1]=item;}else apex.push(item);
  }
  if(apex.length>1&&total-apex[apex.length-1].s+apex[0].s<42&&Math.sign(apex[0].k)===Math.sign(apex[apex.length-1].k)){
    if(Math.abs(apex[0].k)>=Math.abs(apex[apex.length-1].k))apex.pop();else apex.shift();
  }
  const fwd=(from,to)=>{let d=to-from;if(d<0)d+=total;return d;},back=(from,to)=>{let d=from-to;if(d<0)d+=total;return d;};
  function lineAtSample(s){
    let next=null,prev=null,df=Infinity,db=Infinity;
    for(const a of apex){const x=fwd(s,a.s),y=back(s,a.s);if(x<df){df=x;next=a;}if(y<db){db=y;prev=a;}}
    let value=0,weight=0;
    if(next&&df<190){const sign=Math.sign(next.k)||1,str=next.strength,edge=2.75*str,inside=2.50*str,t=df>82?0:1-df/82,v=t<=0?-sign*edge:(-sign*edge)*(1-t)+sign*inside*(t*t*(3-2*t)),w=clamp((190-df)/90,0,1);value+=v*w;weight+=w;}
    if(prev&&db<105){const sign=Math.sign(prev.k)||1,str=prev.strength,inside=2.50*str,exit=-2.25*str,t=clamp(db/92,0,1),e=t*t*(3-2*t),v=sign*inside*(1-e)+sign*exit*e,w=clamp((105-db)/45,0,1);value+=v*w;weight+=w;}
    return clamp(weight>0?value/weight:0,-3.0,3.0);
  }
  for(let i=0;i<count;i++)line[i]=lineAtSample(i*step);
  // A second small smoothing pass keeps steering continuous through chicanes while preserving side changes.
  const tmp=new Float32Array(line);for(let i=0;i<count;i++)line[i]=tmp[wrapIndex(i-2)]*.06+tmp[wrapIndex(i-1)]*.18+tmp[i]*.52+tmp[wrapIndex(i+1)]*.18+tmp[wrapIndex(i+2)]*.06;

  // The speed model follows the curvature of the generated racing line itself, not the centreline.
  // This makes outside-apex-outside genuinely carry more speed instead of being only a visual lane choice.
  const linePoints=new Array(count),lineCurvRaw=new Float32Array(count),lineCurv=new Float32Array(count);
  for(let i=0;i<count;i++)linePoints[i]=W.sample(i*step,line[i]).p;
  for(let i=0;i<count;i++){
    const p0=linePoints[wrapIndex(i-1)],p1=linePoints[i],p2=linePoints[wrapIndex(i+1)],aX=p1.x-p0.x,aZ=p1.z-p0.z,bX=p2.x-p1.x,bZ=p2.z-p1.z,l1=Math.hypot(aX,aZ)||1,l2=Math.hypot(bX,bZ)||1,dot=clamp((aX*bX+aZ*bZ)/(l1*l2),-1,1),cross=(aX*bZ-aZ*bX)/(l1*l2);
    lineCurvRaw[i]=Math.atan2(cross,dot)/Math.max(.5,(l1+l2)*.5);
  }
  for(let i=0;i<count;i++)lineCurv[i]=lineCurvRaw[wrapIndex(i-2)]*.08+lineCurvRaw[wrapIndex(i-1)]*.18+lineCurvRaw[i]*.48+lineCurvRaw[wrapIndex(i+1)]*.18+lineCurvRaw[wrapIndex(i+2)]*.08;

  W.curvatureAt=s=>field(smooth,s);
  W.racingCurvatureAt=s=>field(lineCurv,s);
  W.racingLineAt=s=>field(line,s);
  W.racingLineProfile={count,step,apexes:apex.map(a=>({s:a.s,k:a.k,strength:a.strength}))};

  // Reference map is intentionally the high-downforce upper envelope. Slower classes are
  // restricted by v39-race's class/tyre/weather-specific speed envelope after the shared core.
  const look=[0,22,45,72,105,145,190,235];
  W.braking=s=>{
    const wet=clamp(W.env?.wetness||0,0,1),refTop=88,latAccel=3.70*9.81*(1-wet*.38),brakeAccel=20.0*(1-wet*.34);let allowed=refTop;
    for(const d of look){const k=Math.abs(field(lineCurv,s+d));if(k<.00115)continue;const corner=Math.min(refTop,Math.sqrt(Math.max(1,latAccel/k))),now=Math.sqrt(corner*corner+2*brakeAccel*d);if(now<allowed)allowed=now;}
    return clamp((1-allowed/refTop)/.70,0,1);
  };
  return W;
}

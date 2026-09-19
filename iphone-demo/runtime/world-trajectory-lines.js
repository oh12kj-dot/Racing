import {buildWorld as buildSpectatorWorld} from './world-spectator-atmosphere.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildSpectatorWorld(THREE,TRACK,settings,circuitName),total=Math.max(1,Number(W.total)||1),count=Math.max(900,Math.min(1800,Math.round(total/3.8))),step=total/count;
  const wrap=i=>(i%count+count)%count,field=(arr,s)=>{const u=((((Number(s)||0)%total)+total)%total)/total*count,i=Math.floor(u),f=u-i;return arr[wrap(i)]*(1-f)+arr[wrap(i+1)]*f;};
  const oldLine=W.racingLineAt?.bind(W),oldCurv=(W.racingCurvatureAt||W.curvatureAt)?.bind(W);
  const base=new Float32Array(count),opt=new Float32Array(count),tmp=new Float32Array(count),curv=new Float32Array(count);
  for(let i=0;i<count;i++){const s=i*step;base[i]=clamp(Number(oldLine?.(s))||0,-3.1,3.1);curv[i]=Number(oldCurv?.(s))||0;opt[i]=base[i];}
  for(let pass=0;pass<4;pass++){
    for(let i=0;i<count;i++){
      const k0=curv[i],k1=curv[wrap(i+Math.max(1,Math.round(28/step)))],k2=curv[wrap(i+Math.max(1,Math.round(72/step)))];
      const linked=Math.sign(k1)!==0&&Math.sign(k2)!==0&&Math.sign(k1)!==Math.sign(k2)&&Math.abs(k1)>.0018&&Math.abs(k2)>.0018;
      const same=Math.sign(k1)!==0&&Math.sign(k1)===Math.sign(k2)&&Math.abs(k1)+Math.abs(k2)>.004;
      let v=opt[i]*.48+opt[wrap(i-1)]*.12+opt[wrap(i+1)]*.18+opt[wrap(i+2)]*.12+opt[wrap(i+3)]*.10;
      if(linked)v=v*.74+base[wrap(i+Math.max(1,Math.round(56/step)))]*.26;
      else if(same)v=v*.84+base[wrap(i+Math.max(1,Math.round(34/step)))]*.16;
      if(Math.abs(k0)<.00075&&Math.abs(k1)<.0011)v*=.94;
      tmp[i]=clamp(v,-3.08,3.08);
    }
    for(let i=0;i<count;i++){
      const prev=tmp[wrap(i-1)],maxDelta=clamp(step*.085,.18,.42);opt[i]=clamp(tmp[i],prev-maxDelta,prev+maxDelta);
    }
  }
  // Limiting only lateral velocity still permits the requested lane offset to flip
  // slope in one sample, which creates a false high-curvature kink in an otherwise
  // smooth circuit. Bound the second derivative of the lane profile instead. This
  // changes only how quickly the racing line bends across the track; centreline
  // corner geometry remains authoritative and no vehicle speed/G value is clamped.
  const laneCurvatureLimit=.0045,laneSecondDelta=Math.max(.045,laneCurvatureLimit*step*step);
  for(let pass=0;pass<8;pass++){
    for(let i=0;i<count;i++){
      const mid=(opt[wrap(i-1)]+opt[wrap(i+1)])*.5,half=laneSecondDelta*.5;
      tmp[i]=clamp(opt[i],mid-half,mid+half);
    }
    opt.set(tmp);
  }
  const profiles={OPTIMAL:new Float32Array(opt),ATTACK_LEFT:new Float32Array(count),ATTACK_RIGHT:new Float32Array(count),DEFEND:new Float32Array(count),WET:new Float32Array(count)};
  let wetSideState=-1;
  for(let i=0;i<count;i++){
    const kNow=curv[i],kNext=curv[wrap(i+Math.max(1,Math.round(45/step)))],corner=clamp((Math.abs(kNow)+Math.abs(kNext))*95,0,1),straight=1-corner;
    profiles.ATTACK_LEFT[i]=clamp(opt[i]-(.55+.60*straight),-3.3,3.3);
    profiles.ATTACK_RIGHT[i]=clamp(opt[i]+(.55+.60*straight),-3.3,3.3);
    const inside=Math.sign(kNext||kNow||1),defendBias=inside*(.42+.48*straight);profiles.DEFEND[i]=clamp(opt[i]+defendBias,-3.2,3.2);
    const wetReference=Math.abs(kNext)>.0011?kNext:Math.abs(kNow)>.0011?kNow:0;
    if(wetReference)wetSideState=-Math.sign(wetReference);
    const wetBias=wetSideState*(.55+.35*corner);profiles.WET[i]=clamp(opt[i]+wetBias,-3.25,3.25);
  }
  for(let pass=0;pass<2;pass++){
    for(let i=0;i<count;i++)tmp[i]=profiles.WET[wrap(i-1)]*.18+profiles.WET[i]*.64+profiles.WET[wrap(i+1)]*.18;
    profiles.WET.set(tmp);
  }
  const wetMaxDelta=clamp(step*.055,.16,.28);
  for(let pass=0;pass<2;pass++){
    for(let i=0;i<count;i++){const prev=profiles.WET[wrap(i-1)];profiles.WET[i]=clamp(profiles.WET[i],prev-wetMaxDelta,prev+wetMaxDelta);}
    for(let i=count-1;i>=0;i--){const next=profiles.WET[wrap(i+1)];profiles.WET[i]=clamp(profiles.WET[i],next-wetMaxDelta,next+wetMaxDelta);}
  }
  const curvatureProfiles={};
  function buildCurvature(line){
    const pts=new Array(count),raw=new Float32Array(count),out=new Float32Array(count);
    for(let i=0;i<count;i++)pts[i]=W.sample(i*step,line[i]).p;
    for(let i=0;i<count;i++){
      const p0=pts[wrap(i-1)],p1=pts[i],p2=pts[wrap(i+1)],ax=p1.x-p0.x,az=p1.z-p0.z,bx=p2.x-p1.x,bz=p2.z-p1.z,l1=Math.hypot(ax,az)||1,l2=Math.hypot(bx,bz)||1,dot=clamp((ax*bx+az*bz)/(l1*l2),-1,1),cross=(ax*bz-az*bx)/(l1*l2);raw[i]=Math.atan2(cross,dot)/Math.max(.5,(l1+l2)*.5);
    }
    for(let i=0;i<count;i++)out[i]=raw[wrap(i-2)]*.08+raw[wrap(i-1)]*.18+raw[i]*.48+raw[wrap(i+1)]*.18+raw[wrap(i+2)]*.08;
    return out;
  }
  for(const [name,line] of Object.entries(profiles))curvatureProfiles[name]=buildCurvature(line);
  const modeName=mode=>{const m=String(mode||'OPTIMAL').toUpperCase();return profiles[m]?m:'OPTIMAL';};
  W.racingLineAt=s=>field(profiles.OPTIMAL,s);
  W.racingCurvatureAt=s=>field(curvatureProfiles.OPTIMAL,s);
  W.racingLineFor=(s,mode='OPTIMAL')=>field(profiles[modeName(mode)],s);
  W.racingCurvatureFor=(s,mode='OPTIMAL')=>field(curvatureProfiles[modeName(mode)],s);
  // The final trajectory layer replaces the racing-line curvature built by inner
  // world layers. Rebuild the planning envelope here as well; otherwise the speed
  // planner keeps a closure over the obsolete inner curvature and can miss narrow
  // peaks on the line the car actually follows.
  const demandRadius=Math.max(3.5,step*1.10),demandOffsets=[-demandRadius,-demandRadius*.5,0,demandRadius*.5,demandRadius];
  W.racingCurvatureDemandFor=(s,mode='OPTIMAL')=>{
    const profile=curvatureProfiles[modeName(mode)];let demand=0;
    for(const d of demandOffsets)demand=Math.max(demand,Math.abs(field(profile,(Number(s)||0)+d)));
    return demand;
  };
  W.racingCurvaturePlanningDiagnostics={owner:'runtime-final-line-curvature-demand-v2',gridStep:step,radius:demandRadius,samples:demandOffsets.length};
  W.multiCornerLineDiagnostics={owner:'runtime-multi-corner-line-v3-curvature-continuity',count,step,horizonMeters:125,passes:4,laneCurvatureLimit,laneSecondDelta,wetContinuityDelta:wetMaxDelta,modes:Object.keys(profiles)};
  return W;
}

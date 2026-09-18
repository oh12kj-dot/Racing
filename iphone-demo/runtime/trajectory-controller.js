import {performanceFor} from './vehicle-performance-spec.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrapAngle=a=>{const tau=Math.PI*2;return((a+Math.PI)%tau+tau)%tau-Math.PI;};

export function createTrajectoryController(W,R,{mobile=false}={}){
  const states=new Map(),frame=[],contactLatch=new Set(),total=Math.max(1,Number(W.total)||1);
  const metrics={updates:0,arbitrations:0,safetyVetoes:0,pitApproaches:0,mergeFrames:0,legacySeparationRepairs:0,unhandledContacts:0,physicalSyncs:0,spinPhysicsFrames:0,maxLaneAccel:0,maxYawError:0};
  const tuneFor=c=>{const p=performanceFor(c?.type);return{latG:p.laneChangeG,steer:p.steer,rate:p.steerRate,wheelbase:p.wheelbase};};
  const lineAt=(c,s=c.s)=>clamp(Number(W.racingLineFor?.(s,c.racingLineMode||'OPTIMAL')??W.racingLineAt?.(s)??0)||0,-3.35,3.35);
  const progress=c=>Number(c?._v8Progress??((c?.lap||0)*total+(c?.s||0)))||0;
  const nearLongitudinal=(a,b)=>Math.abs(progress(a)-progress(b));
  const trackPose=(c,yawError=0,longOffset=0)=>{
    if(!c?.mesh)return;const q=W.sample(c.s,c.lane);if(!q?.p||!q?.t)return;
    c.mesh.position.copy(q.p);if(longOffset){c.mesh.position.x+=(q.t.x||0)*longOffset;c.mesh.position.z+=(q.t.z||0)*longOffset;}c.mesh.position.y+=.12;
    const base=Math.atan2(q.t.x,q.t.z),slip=clamp(Number(c.slipAngle)||0,-.55,.55);c.mesh.rotation.y=base+yawError+slip*.35;
  };
  function stateFor(c){
    let s=states.get(c.id);if(!s){s={lane:Number(c.lane)||0,laneV:0,laneA:0,yawError:0,steer:0,steerRate:0,target:Number(c.laneTarget)||Number(c.lane)||0,contactLong:0,source:'INIT'};states.set(c.id,s);}return s;
  }
  function capture(){
    for(const c of R.cars||[]){const s=stateFor(c);s.lane=Number.isFinite(Number(c.lane))?Number(c.lane):s.lane;let x=frame[c.id];if(!x)x=frame[c.id]={};x.lane=s.lane;x.laneV=s.laneV;x.s=Number(c.s)||0;x.v=Number(c.v)||0;x.pitState=c.pitState;x.phase=c._runtimePitPhase||'';x.spin=c.spinState||'NONE';}return frame;
  }
  function legacyIntent(c){return clamp(Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):Number(c.lane)||0,-3.65,3.65);}
  function intent(c){
    const legacy=legacyIntent(c),ideal=lineAt(c),phase=String(c._runtimePitPhase||''),launchAge=(Number(R.race?.t)||0)-(Number(R.race?.green)||0);
    if(String(R.flag||'GREEN')!=='GREEN')return{target:legacy,source:'CAUTION'};
    if(c.pitState==='ENTRY'&&!W.inPitWindow?.(c.s)){metrics.pitApproaches++;return{target:legacy,source:'PIT_APPROACH'};}
    if(phase==='MERGE'){metrics.mergeFrames++;return{target:ideal,source:'PIT_MERGE'};}
    if(c.hazardAvoiding)return{target:legacy,source:'HAZARD'};
    if(c.multiclassPassIntent&&(c.battleState==='ATTACK'||c.racecraftIntent==='MULTICLASS_PASS'))return{target:legacy,source:'MULTICLASS_PASS'};
    if((c.avoid||0)>.05)return{target:legacy,source:'COLLISION_AVOID'};
    if(launchAge>=0&&launchAge<8)return{target:legacy,source:'LAUNCH'};
    if(c.blueFlag)return{target:legacy,source:'BLUE_FLAG'};
    if(c.battleState==='ATTACK'||c.racecraftState==='ATTACK'||c.racecraftState==='SWITCHBACK')return{target:legacy,source:'ATTACK'};
    if(c.battleState==='DEFEND'||c.racecraftState==='DEFEND')return{target:legacy,source:'DEFEND'};
    if(c.coolingMode)return{target:legacy,source:'COOLING'};
    return{target:ideal*.82+legacy*.18,source:'RACING_LINE'};
  }
  function safetyConstrain(c,target){
    let out=target;
    for(const o of R.cars||[]){
      if(o===c||o.retired||o.pitState!=='NONE'||c.pitState!=='NONE')continue;
      const longitudinal=nearLongitudinal(c,o),body=((c.length||5)+(o.length||5))*.5;if(longitudinal>body+8.5)continue;
      const safe=((c.width||2)+(o.width||2))*.5+.46,other=Number(o.lane)||0,current=(Number(c.lane)||0)-other,desired=out-other;
      const crosses=current===0||desired===0||Math.sign(current)!==Math.sign(desired),narrows=Math.abs(desired)<Math.abs(current);
      if((crosses||narrows)&&Math.abs(desired)<safe){const dir=current===0?(c.id<o.id?-1:1):Math.sign(current);out=clamp(other+dir*safe,-3.65,3.65);metrics.safetyVetoes++;}
    }
    return out;
  }
  function latestPhysical(c,horizon=.12){
    const h=R.physicalCrashHistory||[],now=Number(R.race?.t)||0;
    for(let i=h.length-1;i>=0&&i>=h.length-12;i--){const x=h[i];if(now-(Number(x?.t)||0)>horizon)break;if(x?.type==='CAR_CAR'&&(x.a===c.id||x.b===c.id))return x;if(x?.type==='BARRIER'&&x.carId===c.id)return x;}
    return null;
  }
  function syncPhysicalCorrection(c,st){
    if(!c?.mesh||!latestPhysical(c))return false;const q=W.sample(c.s,c.lane);if(!q?.p||!q?.t)return false;
    const side=q.side||{x:q.t.z||0,z:-(q.t.x||0)},dx=(c.mesh.position.x||0)-(q.p.x||0),dz=(c.mesh.position.z||0)-(q.p.z||0),lat=dx*(side.x||0)+dz*(side.z||0),long=dx*(q.t.x||0)+dz*(q.t.z||0);
    const lateral=clamp(lat,-1.15,1.15),longitudinal=clamp(long,-1.15,1.15);if(Math.abs(lateral)<.004&&Math.abs(longitudinal)<.004)return false;
    st.lane=clamp((Number(c.lane)||st.lane)+lateral,-3.72,3.72);c.lane=st.lane;st.laneV=clamp(st.laneV+lateral*3.2,-5,5);st.contactLong=clamp(st.contactLong+longitudinal,-1.35,1.35);metrics.physicalSyncs++;return true;
  }
  function updateCar(c,dt,before){
    const st=stateFor(c),tune=tuneFor(c),session=String(R.sessionPhase||''),phase=String(c._runtimePitPhase||''),preGreen=(Number(R.race?.t)||0)<(Number(R.race?.green)||0);
    if(preGreen||session==='FORMATION'||session==='QUALIFYING'||String(R.flag||'GREEN')==='RED'){
      st.lane=Number(c.lane)||st.lane;st.laneV=0;st.laneA=0;st.yawError=0;st.steer=0;st.steerRate=0;st.contactLong=0;st.target=Number(c.laneTarget)||st.lane;st.source='SESSION_CONTROL';
      c.steeringAngle=0;c.steeringRate=0;c.lateralVelocity=0;c.lateralAcceleration=0;c.yawError=0;c.trajectorySource='SESSION_CONTROL';return;
    }
    if(before&&before.pitState!=='NONE'&&c.pitState==='NONE'&&phase==='MERGE'){
      st.lane=Number.isFinite(Number(c.lane))?Number(c.lane):st.lane;st.laneV=0;st.laneA=0;st.yawError=0;st.steer=0;st.steerRate=0;st.contactLong=0;
    }
    if(before&&before.pitState==='NONE'&&c.pitState==='NONE'&&before.spin==='NONE'&&c.spinState==='NONE'&&(c.incident||0)<=0&&!c.hazardAvoiding&&!['HEAVY','SEVERE','DESTROYED'].includes(String(c.crashState||''))){
      let ds=(Number(c.s)||0)-before.s;if(ds>total*.5)ds-=total;if(ds<-total*.5)ds+=total;
      const afterV=Math.max(0,Number(c.v)||0),expected=Math.max(0,(before.v+afterV)*.5*dt),shortProgress=before.v>10&&afterV>before.v*.72&&expected>.12&&ds<expected*.22;
      if(ds<-.04||shortProgress){c.s=((before.s+expected)%total+total)%total;metrics.legacySeparationRepairs++;}
    }
    if(c.retired||c.pitState==='STOP'||c._runtimePitQueued||c._runtimeReleaseWait){st.lane=Number(c.lane)||st.lane;st.laneV=0;st.laneA=0;st.yawError=0;st.steer=0;st.contactLong=0;return;}
    if((c.pitState==='ENTRY'&&W.inPitWindow?.(c.s))||c.pitState==='EXIT'){
      st.lane=Number(c.lane)||st.lane;st.laneV=0;st.laneA=0;st.yawError=0;st.steer=0;st.contactLong=0;return;
    }
    if(c.spinState!=='NONE'||c.offTrack){
      st.lane=Number(c.lane)||st.lane;st.laneV=clamp(st.laneV,-5,5);st.laneA=0;st.yawError=clamp(Number(c.slipAngle)||0,-.65,.65);st.contactLong=0;c.yawError=st.yawError;c.trajectorySource='PHYSICAL_SPIN';metrics.spinPhysicsFrames++;return;
    }
    syncPhysicalCorrection(c,st);st.contactLong*=Math.exp(-dt*7.5);
    const request=intent(c);let target=safetyConstrain(c,request.target);st.target=target;st.source=request.source;metrics.arbitrations++;
    const v=Math.max(1,Number(c.v)||0),skill=clamp(Number(c.driver?.racecraft)||.84,.65,1),cons=clamp(Number(c.driverProfile?.consistency)||1,.90,1.08),aggr=clamp(Number(c.driver?.aggression)||.6,.35,.97);
    const lookAhead=clamp(5+v*.34,7,31),error=target-st.lane,desiredYaw=clamp(Math.atan2(error,lookAhead),-.36,.36);
    const maxLatA=tune.latG*9.81*clamp(.68+.32*skill,.72,1)*clamp(.92+(cons-1)*.7,.86,1.05),response=clamp(2.15+skill*1.75+aggr*.45,2.6,4.45);
    const maxLaneV=clamp(2.0+v*.035,2.2,4.8),stoppingLaneV=Math.sqrt(Math.max(0,2*maxLatA*Math.abs(error)))*.78;
    let desiredLaneV=clamp(Math.tan(desiredYaw)*v,-maxLaneV,maxLaneV);desiredLaneV=clamp(desiredLaneV,-stoppingLaneV,stoppingLaneV);
    const wantedA=clamp(error*response+(desiredLaneV-st.laneV)*(2.3+skill),-maxLatA,maxLatA),jerkLimit=maxLatA*(mobile?3.0:3.8),deltaA=clamp(wantedA-st.laneA,-jerkLimit*dt,jerkLimit*dt);st.laneA+=deltaA;
    st.laneV=clamp(st.laneV+st.laneA*dt,-maxLaneV,maxLaneV);
    const nextLane=st.lane+st.laneV*dt,crossed=Math.abs(error)>.001&&Math.sign(target-nextLane)!==Math.sign(error);
    if(crossed){st.lane=target;st.laneV*=.18;st.laneA*=.35;}
    else if(Math.abs(error)<.035&&Math.abs(st.laneV)<.25){st.lane=target;st.laneV*=.5;}
    else st.lane=nextLane;
    st.lane=clamp(st.lane,-3.72,3.72);if(st.lane===-3.72||st.lane===3.72)st.laneV*=.35;
    const yawFromMotion=Math.asin(clamp(st.laneV/v,-.48,.48)),wheelbase=tune.wheelbase,maxSteer=tune.steer*clamp(1.12-v/130,.52,1),desiredSteer=clamp(Math.atan2(wheelbase*Math.tan(yawFromMotion),Math.max(2,v*.10)),-maxSteer,maxSteer),maxStep=tune.rate*dt;
    const oldSteer=st.steer;st.steer+=clamp(desiredSteer-st.steer,-maxStep,maxStep);st.steerRate=(st.steer-oldSteer)/Math.max(.001,dt);st.yawError=wrapAngle(yawFromMotion);
    c.lane=st.lane;c.laneTarget=target;c.steeringAngle=st.steer;c.steeringRate=st.steerRate;c.lateralVelocity=st.laneV;c.lateralAcceleration=st.laneA;c.yawError=st.yawError;c.trajectorySource=request.source;c.trajectoryTarget=target;
    trackPose(c,st.yawError,st.contactLong);metrics.maxLaneAccel=Math.max(metrics.maxLaneAccel,Math.abs(st.laneA));metrics.maxYawError=Math.max(metrics.maxYawError,Math.abs(st.yawError));
  }
  function recentPhysical(a,b){const h=R.physicalCrashHistory||[];for(let i=h.length-1;i>=0&&i>=h.length-10;i--){const x=h[i];if((R.race?.t||0)-(x.t||0)>.16)break;if(x.type==='CAR_CAR'&&((x.a===a.id&&x.b===b.id)||(x.a===b.id&&x.b===a.id)))return true;}return false;}
  function overlapOBB(a,b){
    const ay=a.mesh?.rotation?.y||0,by=b.mesh?.rotation?.y||0,afx=Math.sin(ay),afz=Math.cos(ay),arx=Math.cos(ay),arz=-Math.sin(ay),bfx=Math.sin(by),bfz=Math.cos(by),brx=Math.cos(by),brz=-Math.sin(by),aL=(a.length||5)*.5,aW=(a.width||2)*.5,bL=(b.length||5)*.5,bW=(b.width||2)*.5,dx=(b.mesh?.position?.x||0)-(a.mesh?.position?.x||0),dz=(b.mesh?.position?.z||0)-(a.mesh?.position?.z||0);
    const separated=(x,z)=>{const al=aL*Math.abs(afx*x+afz*z)+aW*Math.abs(arx*x+arz*z),bl=bL*Math.abs(bfx*x+bfz*z)+bW*Math.abs(brx*x+brz*z);return al+bl-Math.abs(dx*x+dz*z)<=.02;};
    return !separated(afx,afz)&&!separated(arx,arz)&&!separated(bfx,bfz)&&!separated(brx,brz);
  }
  function recentEventContact(a,b,now){const e=R.events||[];for(let i=e.length-1;i>=0&&i>=e.length-12;i--){const x=e[i];if(now-(x?.t||0)>=.14)break;if(x?.type==='CONTACT'&&((x.carId===a.id&&x.data?.otherId===b.id)||(x.carId===b.id&&x.data?.otherId===a.id)))return true;}return false;}
  function auditContacts(){
    const session=String(R.sessionPhase||''),now=R.race?.t||0;if(now<(Number(R.race?.green)||0)||session==='FORMATION'||session==='QUALIFYING'||String(R.flag||'GREEN')==='RED')return;
    const cars=R.cars||[];
    for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
      const a=cars[i],b=cars[j],code=i*64+j;if(a.retired||b.retired||a.pitState!=='NONE'||b.pitState!=='NONE'||!a.mesh||!b.mesh){contactLatch.delete(code);continue;}
      if(!overlapOBB(a,b)){contactLatch.delete(code);continue;}
      if(R.resolvePhysicalPair?.(a,b)){contactLatch.add(code);continue;}
      if(recentPhysical(a,b)||recentEventContact(a,b,now)){contactLatch.add(code);continue;}
      if(contactLatch.has(code))continue;contactLatch.add(code);
      const rel=Math.hypot(((a.v||0)-(b.v||0))*3.6,((a.lateralVelocity||0)-(b.lateralVelocity||0))*3.6),sev=clamp((rel-6)/95,0,1),dmg=.004+sev*.075;a.damage=clamp((a.damage||0)+dmg,0,1);b.damage=clamp((b.damage||0)+dmg,0,1);
      if(sev>.42){if(a.spinState==='NONE'){a.spinState='SLIDE';a.spinSeverity=Math.max(a.spinSeverity||0,.36+sev*.35);}if(b.spinState==='NONE'){b.spinState='SLIDE';b.spinSeverity=Math.max(b.spinSeverity||0,.36+sev*.35);}}
      R.events?.push({id:`traj-contact-${Date.now()}-${i}-${j}`,type:'CONTACT',t:now,carId:a.id,data:{otherId:b.id,physical:true,trajectoryAudit:true,impactKmh:Math.round(rel),severity:sev}});metrics.unhandledContacts++;
    }
  }
  function update(dt,snapshot){const step=clamp(Number(dt)||.016,.001,.05);for(const c of R.cars||[])updateCar(c,step,snapshot?.[c.id]);R.resolvePhysicalContacts?.(false);auditContacts();metrics.updates++;}
  function diagnostics(){return{owner:'runtime-trajectory-controller-v5-class-calibrated',...metrics,snapshotAllocations:1,contactLatches:contactLatch.size,cars:[...states.entries()].map(([id,s])=>({id,lane:s.lane,laneV:s.laneV,laneA:s.laneA,yawError:s.yawError,steer:s.steer,target:s.target,contactLong:s.contactLong,source:s.source}))};}
  return{capture,update,diagnostics};
}

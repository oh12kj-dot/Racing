import {createRace as createV38Race} from './v38-race.js';
import {damagePerformanceFactors,performanceFor,trafficFollowPolicy} from './vehicle-performance-spec.js';

export function createRace(W,statusEl,settings={}){
  const R=createV38Race(W,statusEl,settings),baseUpdate=R.update,total=W.total,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=s=>((s%total)+total)%total;
  // Track-aware braking must resolve short high-curvature features (hairpins/chicanes),
  // not just a handful of sparse samples. Six-metre spacing is close to the world
  // curvature grid resolution while 300 m covers the longest wet braking approaches.
  const look=Array.from({length:51},(_,i)=>i*6),controllers=new Map(),preSpeed=[],preS=[],prePit=[],telemetry=[];
  const serviceTime={formula:2.6,proto:3.1,hyper:3.3,lmh:3.2,gt:4.1,supercar:4.3,touring:4.7};
  let telemetryAcc=0;
  const punctured=c=>c?.fault==='PUNCTURE'||(c?.wheelState||[]).some(w=>w?.puncture);
  const clearState=c=>!c.retired&&c.pitState==='NONE'&&c.spinState==='NONE'&&!c.hazardAvoiding&&!c.localYellow&&!c.hydroplaning&&!punctured(c)&&(c.incident||0)<=0;
  for(const c of R.cars)controllers.set(c.id,{target:c.v||0,accel:0,prevAccel:0,mode:'COAST',hold:0,raw:c.v||0,line:'OPTIMAL',jerk:0});

  function aheadOf(c){const r=R.spatialNeighbours?.get?.(c.id);return r?.aheadView||r?.ahead||null;}
  function chooseLine(c){
    const wet=W.env?.wetness||0;if(wet>.42)return'WET';
    if(c.battleState==='DEFEND')return'DEFEND';
    if(c.battleState==='ATTACK'||c.multiclassPassIntent){
      const a=aheadOf(c)?.car;if(a)return(a.lane||0)>=(c.lane||0)?'ATTACK_LEFT':'ATTACK_RIGHT';
      return c.id%2?'ATTACK_LEFT':'ATTACK_RIGHT';
    }
    return'OPTIMAL';
  }
  function lineValue(c,mode,s=c.s){return clamp(W.racingLineFor?.(s,mode)??W.racingLineAt?.(s)??0,-3.25,3.25);}
  function lineCurv(mode,s){return W.racingCurvatureFor?.(s,mode)??W.racingCurvatureAt?.(s)??W.curvatureAt?.(s)??0;}
  function applyLine(c,dt){
    if(!clearState(c)||R.flag!=='GREEN'||R.sessionPhase==='FORMATION')return;
    const st=controllers.get(c.id),mode=chooseLine(c),ideal=lineValue(c,mode),traffic=(c.avoid||0)>0||c.blueFlag||c.coolingMode;
    st.line=mode;c.racingLineMode=mode;c.racingLineTarget=ideal;
    // Existing pass/avoid logic owns the lane during close traffic; otherwise use the planned line.
    if(traffic||c.multiclassPassIntent||c.battleState==='ATTACK'||c.battleState==='DEFEND')return;
    const strength=clamp(Math.abs(lineCurv(mode,c.s+55))*55+Math.abs(lineCurv(mode,c.s))*25,0,1),rate=1.25+strength*1.75,f=1-Math.exp(-rate*dt);
    c.laneTarget+=(ideal-c.laneTarget)*f;
  }
  function surfaceLine(c){
    if(!clearState(c)||!R.trackEvolution)return;
    const st=controllers.get(c.id),ideal=lineValue(c,st?.line||chooseLine(c)),deviation=Math.abs((c.lane||0)-ideal),off=clamp((deviation-1.20)/2.35,0,1),e=R.trackEvolution;
    c.trackEvolutionGrip=1+(e.dryLine||0)*.018*(1-off)-(e.marbles||0)*.055*off;c.racingLineDeviation=deviation;
  }
  function speedEnvelope(c,mode){
    const spec=performanceFor(c.type),damage=damagePerformanceFactors(c),baseTop=c._v18BaseMax||c.classPerformance?.top||c.baseMax||c.baseMaxNominal||c.max||spec.top,top=Math.max(24,baseTop)*(1+(c.slipstream||0)*spec.draftGain)*damage.top,wet=clamp(Number(W.env?.wetness)||0,0,1),wear=clamp(c.wear||0,0,1),tempGrip=clamp(c.tempGrip||1,.75,1.08),surface=clamp(c.surfaceGrip||1,.80,1.08),evolution=clamp(c.trackEvolutionGrip||1,.88,1.04),damageAero=clamp(Math.min(c.aeroFront??1,c.aeroRear??1),.45,1),aero=clamp(spec.aero*damageAero,.45,1),classGrip=clamp(c.classPerformance?.tyre??spec.tyre,.88,1.12),wetRetention=clamp(1-wet*(1-(c.classPerformance?.wet??spec.wet)),.68,1),tyreGrip=clamp(tempGrip*surface*evolution*classGrip*(1-wear*.13)*wetRetention,.50,1.12),ideal=lineValue(c,mode),deviation=Math.abs((c.lane||0)-ideal),cornerDemand=clamp(Math.abs(lineCurv(mode,c.s+28))*70,0,1),lineEfficiency=1-cornerDemand*clamp(deviation/3,0,1)*.10,dirtyAirScale=clamp(1-(c.dirtyAir||0)*spec.dirtyAirLoss,.78,1),gCap=spec.lateralG*9.81*tyreGrip*(.82+.18*aero)*lineEfficiency*dirtyAirScale*damage.lateral,brakeBase=Math.max(7,c._v18BaseBrake||c.brake||spec.brake)*clamp(.74+.26*tyreGrip,.62,1.04)*(1-wet*.20)*damage.brake;let target=top;
    for(const d of look){const k=Math.abs(lineCurv(mode,c.s+d));if(k<.00105)continue;const corner=Math.min(top,Math.sqrt(Math.max(1,gCap/k))),allowed=Math.sqrt(corner*corner+2*brakeBase*d);if(allowed<target)target=allowed;}
    const a=aheadOf(c);if(a?.car&&a.dist<120){const other=a.car,lat=Math.abs((other.lane||0)-(c.lane||0)),safeLat=(c.width+other.width)*.48+.35,overlap=lat<safeLat,plannedLat=Math.abs((Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):(c.lane||0))-(Number.isFinite(Number(other.laneTarget))?Number(other.laneTarget):(other.lane||0))),bodyGap=(c.length+other.length)*.5,passIntent=!!c.multiclassPassIntent&&(!Number.isFinite(Number(c.multiclassPassTargetId))||Number(c.multiclassPassTargetId)===Number(other.id)),follow=trafficFollowPolicy({followerType:c.type,leaderType:other.type,gapM:a.dist,speedMps:c.v||0,leaderSpeedMps:other.v||0,bodyGapM:bodyGap,currentLateralM:lat,plannedLateralM:plannedLat,safeLateralM:safeLat,passIntent});if(overlap&&follow.shouldCap)target=Math.min(target,follow.allowedSpeed);c.racingTrafficPolicy={leaderId:other.id,...follow};}
    c.racingDamagePerformance=damage;c.racingLineDeviation=deviation;return{target:Math.max(8,target),brakeBase,gCap,accelScale:damage.accel};
  }
  function longitudinal(c,dt,before){
    const st=controllers.get(c.id);if(!st)return;
    if(!clearState(c)||R.flag!=='GREEN'||R.sessionPhase==='FORMATION'){
      st.target=c.v||0;st.raw=st.target;st.accel=0;st.prevAccel=0;st.mode='COAST';st.hold=0;st.jerk=0;c.racingThrottle=0;c.racingBrake=0;c.racingSafetyCap=null;return;
    }
    const mode=st.line||chooseLine(c),x=speedEnvelope(c,mode);st.raw=x.target;
    if(!Number.isFinite(st.target)||Math.abs(st.target-before)>35)st.target=x.target;
    const tau=x.target<st.target?.24:.78,blend=1-Math.exp(-dt/tau);st.target+=(x.target-st.target)*blend;
    const safetyCap=Number(c.predictiveSpeedCap),safetyActive=c.predictiveSpeedCap!=null&&Number.isFinite(safetyCap)&&safetyCap>=0;
    if(safetyActive){st.target=Math.min(st.target,safetyCap);st.raw=Math.min(st.raw,safetyCap);}
    const error=st.target-before;st.hold=Math.max(0,st.hold-dt);const wanted=error<-1.40?'BRAKE':error>1.80?'THROTTLE':'COAST';if(wanted!==st.mode&&(st.hold<=0||error<-4.8)){st.mode=wanted;st.hold=wanted==='COAST'?.20:.30;}
    const spec=performanceFor(c.type),k=Math.abs(lineCurv(mode,c.s)),latDemand=before*before*k,latUse=clamp(latDemand/Math.max(1,x.gCap),0,.985),longAvail=Math.sqrt(Math.max(.03,1-latUse*latUse)),accelBase=Math.max(2.5,c._v18BaseAccel||c.accel||spec.accel)*x.accelScale*(1+(c.energyMode==='PUSH'?.07:0))*(.45+.55*longAvail),brakeAvail=x.brakeBase*(.30+.70*longAvail);
    let desiredA=0;if(st.mode==='BRAKE'){const demand=clamp((-error-.45)/7.8,.08,1);desiredA=-brakeAvail*demand;}else if(st.mode==='THROTTLE'){const demand=clamp((error-.50)/8.8,0,1);desiredA=accelBase*demand;}else desiredA=-clamp(.14+before*.0035,.14,.48);
    st.prevAccel=st.accel;const releasingBrake=st.mode!=='BRAKE'&&st.accel<-1&&desiredA>st.accel,jerkLimit=desiredA<st.accel?22:releasingBrake?Math.max(32,brakeAvail*1.65):7.5,maxDelta=jerkLimit*dt;st.accel+=clamp(desiredA-st.accel,-maxDelta,maxDelta);st.jerk=(st.accel-st.prevAccel)/Math.max(.001,dt);
    // Brake release is much faster than positive throttle buildup. Keeping the
    // normal acceleration jerk limit here can preserve a safety-braking impulse
    // for several seconds after the cap clears and stop a car that is on throttle.
    // This is the single normal-green longitudinal output. Legacy core speed changes are
    // deliberately overwritten here; explicit safety caps are applied by this same owner.
    c.v=Math.max(0,before+st.accel*dt);
    if(safetyActive&&c.v>safetyCap){const physicalSafetyLimit=Math.max(safetyCap,before-brakeAvail*dt);c.v=Math.min(c.v,physicalSafetyLimit);st.accel=(c.v-before)/Math.max(.001,dt);st.jerk=(st.accel-st.prevAccel)/Math.max(.001,dt);st.mode='BRAKE';}
    c.racingSafetyCap=safetyActive?safetyCap:null;c.racingSpeedRaw=st.raw;c.racingSpeedTarget=st.target;c.racingLongAccel=st.accel;c.racingJerk=st.jerk;c.racingMode=st.mode;c.racingBrake=clamp(-st.accel/Math.max(1,brakeAvail),0,1);c.racingThrottle=safetyActive?0:clamp(st.accel/Math.max(1,accelBase),0,1);c.racingLatUse=latUse;if(c.racingBrake>.02)c.brakeVisual=Math.max(c.brakeVisual||0,c.racingBrake);
  }

  function removePitStopEvent(carId,eventStart){if(!Array.isArray(R.events))return;for(let i=R.events.length-1;i>=eventStart;i--)if(R.events[i]?.carId===carId&&R.events[i]?.type==='PIT_STOP')R.events.splice(i,1);}
  function posePit(c){if(!W.pitPose||c.pitState==='NONE')return;const q=W.pitPose(c.s,c.teamId,c.pitState);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=q.rotationY;}
  function managePit(c,dt,beforeState,beforeV,eventStart){
    if(c.retired||!W.pitDistanceToBox)return;
    if(beforeState==='NONE'&&c.pitState==='ENTRY')c._v41PitManaged=true;
    if(!c._v41PitManaged&&c.pitState==='NONE')return;
    const dist=W.pitDistanceToBox(c.s,c.teamId);
    if(beforeState==='ENTRY'&&c.pitState==='STOP'&&dist>Math.max(1.2,beforeV*dt*1.45)){
      // Legacy core stops every car as soon as it crosses s=0. Keep travelling until its own box.
      c.pitState='ENTRY';c.pitTimer=0;c.v=Math.min(Math.max(beforeV,7),W.pitSpeedLimit||22.22);removePitStopEvent(c.id,eventStart);
    }
    if(c.pitState==='ENTRY'){
      if(W.inPitSpeedZone?.(c.s))c.v=Math.min(Math.max(c.v,7),W.pitSpeedLimit||22.22);
      const threshold=Math.max(1.0,(c.v||beforeV)*dt*1.6);
      if(dist<=threshold&&dist>-4.0){const bs=W.pitBoxS(c.teamId);c.s=bs;c.v=0;c.pitState='STOP';c.pitTimer=serviceTime[c.type]||3.5;c._pitStopInitial=c.pitTimer;c.pitLaneStatus='JACKS';}
    }
    if(beforeState==='EXIT'&&c.pitState==='NONE'){
      const uf=W.pitUnwrappedFraction?.(c.s)||0,exit=W.pitComplexV41?.exitEnd||1.095;if(uf<exit){c.pitState='EXIT';c.v=Math.min(Math.max(beforeV,8),W.pitSpeedLimit||22.22);c.pitLaneStatus='PIT EXIT';}
      else c._v41PitManaged=false;
    }
    if(c.pitState==='STOP'){c.s=W.pitBoxS(c.teamId);c.v=0;}
    if(c.pitState!=='NONE')posePit(c);else if(c._v41PitManaged===false)c.pitLaneStatus='TRACK';
  }

  // Hazard-only spatial grid is retained only as a fallback when the physical authority is unavailable.
  const extraLatch=new Set(),shapeA={},shapeB={};
  function fillShape(c,o){const y=c.mesh.rotation.y||0;o.fx=Math.sin(y);o.fz=Math.cos(y);o.rx=Math.cos(y);o.rz=-Math.sin(y);o.L=(c.length||5.1)*.5;o.W=(c.width||2)*.5;o.x=c.mesh.position.x;o.z=c.mesh.position.z;}
  function rad(o,x,z){return o.L*Math.abs(o.fx*x+o.fz*z)+o.W*Math.abs(o.rx*x+o.rz*z);}
  function overlapOBB(a,b){fillShape(a,shapeA);fillShape(b,shapeB);const dx=shapeB.x-shapeA.x,dz=shapeB.z-shapeA.z,axes=[[shapeA.fx,shapeA.fz],[shapeA.rx,shapeA.rz],[shapeB.fx,shapeB.fz],[shapeB.rx,shapeB.rz]];for(const [x,z] of axes){const l=Math.hypot(x,z)||1,ax=x/l,az=z/l;if(rad(shapeA,ax,az)+rad(shapeB,ax,az)-Math.abs(dx*ax+dz*az)<=0)return false;}return true;}
  function recentBaseContact(a,b){const h=R.physicalCrashHistory||[];for(let i=h.length-1;i>=0&&i>=h.length-8;i--){const x=h[i];if(R.race.t-x.t>.20)break;if(x.type==='CAR_CAR'&&((x.a===a.id&&x.b===b.id)||(x.a===b.id&&x.b===a.id)))return true;}return false;}
  function pileupContacts(){
    if(typeof R.resolvePhysicalContacts==='function')return;
    const hazards=R.cars.filter(c=>!c.retired&&c.pitState==='NONE'&&c.mesh?.visible!==false&&(c.spinState!=='NONE'||(c.v||0)<7||['HEAVY','SEVERE'].includes(c.crashState)));if(!hazards.length)return;
    const cell=12,grid=new Map(),key=(x,z)=>`${Math.floor(x/cell)},${Math.floor(z/cell)}`;for(const c of R.cars){if(c.retired||c.pitState!=='NONE'||c.mesh?.visible===false)continue;const k=key(c.mesh.position.x,c.mesh.position.z);let a=grid.get(k);if(!a)grid.set(k,a=[]);a.push(c);}const live=new Set();
    for(const h of hazards){const cx=Math.floor(h.mesh.position.x/cell),cz=Math.floor(h.mesh.position.z/cell);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const list=grid.get(`${cx+dx},${cz+dz}`)||[];for(const o of list){if(o===h)continue;const a=Math.min(h.id,o.id),b=Math.max(h.id,o.id),code=a*64+b;if(live.has(code)){continue;}live.add(code);if(recentBaseContact(h,o)||!overlapOBB(h,o))continue;if(extraLatch.has(code))continue;extraLatch.add(code);const rel=Math.abs((h.v||0)-(o.v||0))*3.6+Math.min(h.v||0,o.v||0)*1.2,sev=clamp((rel-12)/150,0,1),dmg=.018+sev*.34;for(const c of[h,o]){c.damage=clamp((c.damage||0)+dmg,0,1);if(c.damage>.90){c.damage=1;c.v=0;c.retired=true;c.fault='CRASH';c.crashState='DESTROYED';}else if(rel>48&&c.spinState==='NONE'){c.spinState='SLIDE';c.spinSeverity=Math.max(c.spinSeverity||0,.45+sev*.4);}W.updateCarDamage?.(c);}R.events?.push({id:`v41pile-${Date.now()}-${Math.random()}`,type:'CONTACT',t:R.race.t,carId:h.id,data:{otherId:o.id,physical:true,pileup:true,impactKmh:Math.round(rel),severity:sev}});}}}
    for(const code of extraLatch)if(!live.has(code))extraLatch.delete(code);
  }

  function sampleTelemetry(){const snap={t:R.race.t,cars:R.cars.map(c=>({id:c.id,speed:c.v*3.6,raw:c.racingSpeedRaw??null,target:c.racingSpeedTarget??null,accel:c.racingLongAccel??0,jerk:c.racingJerk??0,throttle:c.racingThrottle??0,brake:c.racingBrake??0,mode:c.racingMode||'CORE',line:c.racingLineMode||'CORE',lineDeviation:c.racingLineDeviation??0,latUse:c.racingLatUse??0,curvature:lineCurv(c.racingLineMode||'OPTIMAL',c.s),pit:c.pitState,spin:c.spinState,damage:c.damage||0,damagePerformance:c.racingDamagePerformance??null}))};telemetry.push(snap);while(telemetry.length>600)telemetry.shift();}

  function update(dt){
    const eventStart=R.events?.length||0;for(let i=0;i<R.cars.length;i++){const c=R.cars[i];preSpeed[c.id]=c.v||0;preS[c.id]=c.s||0;prePit[c.id]=c.pitState;applyLine(c,dt);}baseUpdate(dt);
    for(const c of R.cars){surfaceLine(c);longitudinal(c,dt,preSpeed[c.id]??c.v??0);managePit(c,dt,prePit[c.id],preSpeed[c.id]||0,eventStart);}pileupContacts();telemetryAcc+=dt;if(telemetryAcc>=.10){telemetryAcc%=.10;sampleTelemetry();}
  }

  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='racingDynamics')return R.cars.map(c=>({carId:c.id,line:c.racingLineTarget??0,lineMode:c.racingLineMode||'OPTIMAL',lineDeviation:c.racingLineDeviation??0,rawTarget:c.racingSpeedRaw??0,targetSpeed:c.racingSpeedTarget??0,longAccel:c.racingLongAccel??0,jerk:c.racingJerk??0,latUse:c.racingLatUse??0,mode:c.racingMode||'COAST',brake:c.racingBrake??0,throttle:c.racingThrottle??0,safetyCap:c.racingSafetyCap??null,traffic:c.racingTrafficPolicy??null,damagePerformance:c.racingDamagePerformance??null}));if(prop==='dynamicsTelemetry')return telemetry;if(prop==='getDynamicsLog')return carId=>telemetry.map(x=>({t:x.t,...x.cars.find(c=>c.id===Number(carId))}));return Reflect.get(target,prop,target);}});
}

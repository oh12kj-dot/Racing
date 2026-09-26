export function createEnvironment(W,R,settings={}){
  const T=W.THREE,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  // Wet-road overlay and rain particles (flattened from the mature v10/v21 path).
  const wetMat=new T.MeshPhysicalMaterial({color:0x20282d,roughness:.22,metalness:.08,transparent:true,opacity:0,depthWrite:false,side:T.DoubleSide,envMapIntensity:1.25,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
  const seg=480,pos=[],ind=[];
  for(let i=0;i<seg;i++){const s=W.total*i/seg,q=W.sample(s),l=q.p.clone().addScaledVector(q.side,-7.05),r=q.p.clone().addScaledVector(q.side,7.05);l.y+=.110;r.y+=.110;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);}
  for(let i=0;i<seg;i++){const j=(i+1)%seg,a=i*2,b=a+1,c=j*2,d=c+1;ind.push(a,b,c,b,d,c);}
  const wg=new T.BufferGeometry();wg.setAttribute('position',new T.Float32BufferAttribute(pos,3));wg.setIndex(ind);wg.computeVertexNormals();
  const wetRoad=new T.Mesh(wg,wetMat);wetRoad.name='WET_ROAD_OVERLAY';wetRoad.renderOrder=2;W.scene.add(wetRoad);

  const rainCount=420,rp=new Float32Array(rainCount*3);
  for(let i=0;i<rainCount;i++){rp[i*3]=(Math.random()-.5)*180;rp[i*3+1]=Math.random()*100;rp[i*3+2]=(Math.random()-.5)*180;}
  const rg=new T.BufferGeometry();rg.setAttribute('position',new T.BufferAttribute(rp,3));
  const rm=new T.PointsMaterial({color:0xd8ebff,size:.65,transparent:true,opacity:0,depthWrite:false});
  const rainPoints=new T.Points(rg,rm);rainPoints.name='RUNTIME_RAIN';W.scene.add(rainPoints);

  let rainLevel=0,weather='SUNNY',radarClock=0,radar={updatedAt:0,horizons:[],segments:[]};
  function globalAt(t){
    switch(settings.weather){
      case'SUNNY':return{weather:'SUNNY',rain:0,cloud:.12};
      case'CLOUDY':return{weather:'CLOUDY',rain:0,cloud:.70};
      case'LIGHT_RAIN':return{weather:'LIGHT RAIN',rain:.38,cloud:.90};
      case'RAIN':return{weather:'RAIN',rain:.82,cloud:1};
      default:{const p=((t%330)+330)%330;if(p<70)return{weather:'SUNNY',rain:0,cloud:.12};if(p<125)return{weather:'CLOUDY',rain:0,cloud:.62};if(p<190)return{weather:'LIGHT RAIN',rain:.38,cloud:.88};if(p<245)return{weather:'RAIN',rain:.82,cloud:1};if(p<290)return{weather:'DRYING',rain:.10,cloud:.58};return{weather:'SUNNY',rain:0,cloud:.18};}
    }
  }
  function localRain(frac,t){
    const g=globalAt(t).rain;if(g<=.001)return 0;if(settings.weather&&settings.weather!=='DYNAMIC')return g;
    const drift=t*.0018,ang=(frac-drift)*Math.PI*2,cell=.58+.30*Math.cos(ang)+.18*Math.cos(ang*2+1.35)+.12*Math.sin(ang*3-.55);
    return clamp(g*clamp(cell,.18,1.22),0,1);
  }
  function rainAt(s,offsetSeconds=0){const frac=((Number(s)||0)/Math.max(1,W.total)%1+1)%1;return localRain(frac,R.race.t+offsetSeconds);}
  function buildRadar(){
    const horizons=[0,60,180,300,600],segments=24,rows=horizons.map(sec=>({seconds:sec,global:globalAt(R.race.t+sec),values:Array.from({length:segments},(_,i)=>localRain(i/segments,R.race.t+sec))}));
    radar={updatedAt:R.race.t,horizons:rows,segments:rows[0]?.values||[]};W.env.radar=radar;W.env.rainAt=rainAt;
  }

  // Dynamic sky (flattened from v38) remains intentionally lightweight on mobile.
  const nw=96,nh=48,data=new Uint8Array(nw*nh*4);let prev=128;
  for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){const i=(y*nw+x)*4,r=Math.random()*255;prev=prev*.58+r*.42;const cloud=clamp(prev+28*Math.sin(x*.19)+20*Math.sin((x+y)*.11),0,255),star=Math.random()>.993?255:0;data[i]=cloud;data[i+1]=star;data[i+2]=0;data[i+3]=255;}
  const noise=new T.DataTexture(data,nw,nh,T.RGBAFormat);noise.wrapS=noise.wrapT=T.RepeatWrapping;noise.minFilter=T.LinearFilter;noise.magFilter=T.LinearFilter;noise.needsUpdate=true;
  const uniforms={uTop:{value:new T.Color(0x4389cc)},uHorizon:{value:new T.Color(0xc4d9e8)},uCloudColor:{value:new T.Color(0xe5eaed)},uSunDir:{value:new T.Vector3(0,1,0)},uMoonDir:{value:new T.Vector3(0,-1,0)},uCloud:{value:0},uRain:{value:0},uNight:{value:0},uTwilight:{value:0},uTime:{value:0},uNoise:{value:noise}};
  const skyMat=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,depthTest:false,fog:false,toneMapped:false,uniforms,
    vertexShader:`varying vec3 vDir;varying vec2 vUv;void main(){vDir=position;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`precision mediump float;varying vec3 vDir;varying vec2 vUv;uniform vec3 uTop,uHorizon,uCloudColor,uSunDir,uMoonDir;uniform float uCloud,uRain,uNight,uTwilight,uTime;uniform sampler2D uNoise;
    void main(){vec3 d=normalize(vDir);float y=clamp(d.y*.98+.04,0.0,1.0);vec3 col=mix(uHorizon,uTop,pow(y,.48));
      vec2 drift=vec2(uTime*.000035,0.0);float n1=texture2D(uNoise,fract(vUv*vec2(1.8,1.15)+drift)).r;float n2=texture2D(uNoise,fract(vUv*vec2(3.7,2.25)-drift*.63+vec2(.31,.17))).r;float cloudNoise=n1*.68+n2*.32;
      float cloudBand=smoothstep(-.12,.08,d.y)*(1.0-smoothstep(.88,1.0,d.y));float cloudMask=smoothstep(.58-uCloud*.28,.82-uCloud*.12,cloudNoise)*cloudBand*clamp(uCloud*1.55,0.0,1.0);col=mix(col,uCloudColor,cloudMask*(.58+uRain*.30));
      float sunDot=dot(d,normalize(uSunDir)),sun=smoothstep(.9987,.99975,sunDot),glow=smoothstep(.965,.9995,sunDot)*(.24+.34*uTwilight);vec3 sunCol=mix(vec3(1.0,.91,.70),vec3(1.0,.35,.10),uTwilight);col+=sunCol*(sun*1.30+glow*.28)*(1.0-cloudMask*.82)*(1.0-uRain*.72)*(1.0-uNight);
      float moon=smoothstep(.99915,.99978,dot(d,normalize(uMoonDir)))*uNight;col+=vec3(.66,.77,1.0)*moon*(1.0-cloudMask*.75);
      float stars=step(.985,texture2D(uNoise,fract(vUv*vec2(2.9,1.7)+vec2(.13,.41))).g)*uNight*smoothstep(.02,.22,d.y)*(1.0-cloudMask)*(1.0-uRain);col+=vec3(.80,.88,1.0)*stars*1.35;
      float hz=(1.0-smoothstep(0.0,.18,abs(d.y)))*uTwilight;col+=vec3(.85,.16,.045)*hz*(1.0-uRain*.72)*.42;col*=1.0-uRain*.13;gl_FragColor=vec4(col,1.0);}`});
  const sky=new T.Mesh(new T.SphereGeometry(1550,28,16),skyMat);sky.name='RUNTIME_DYNAMIC_SKY';sky.renderOrder=-10000;sky.frustumCulled=false;W.scene.add(sky);
  const hemis=[];W.scene.traverse(o=>{if(o.isHemisphereLight)hemis.push({light:o,base:o.intensity});});
  const dayTop=new T.Color(0x3788d0),dayHorizon=new T.Color(0xbfd9ec),nightTop=new T.Color(0x020611),nightHorizon=new T.Color(0x111a31),sunsetTop=new T.Color(0x2f426f),sunsetHorizon=new T.Color(0xff8052),storm=new T.Color(0x4d5961),cloudDay=new T.Color(0xe7ebed),cloudNight=new T.Color(0x252d37),tmpTop=new T.Color(),tmpHorizon=new T.Color(),tmpCloud=new T.Color(),backgroundColor=new T.Color();
  W.scene.background=backgroundColor;

  function updateBase(dt){
    const tw=globalAt(R.race.t);weather=tw.weather;rainLevel=T.MathUtils.lerp(rainLevel,tw.rain,1-Math.exp(-.8*dt));
    W.env.rain=rainLevel;W.env.weather=weather;W.env.cloud=tw.cloud;
    W.env.wetness=T.MathUtils.lerp(W.env.wetness,Math.min(1,rainLevel*1.15+(weather==='DRYING'?.22:0)),1-Math.exp(-(rainLevel>W.env.wetness?.35:.08)*dt));
    const start=Number(settings.time)||14.2;W.env.timeOfDay=(start+R.race.t*.0065)%24;W.env.temperature=Math.round(27-rainLevel*5);
    wetMat.opacity=W.env.wetness*.28;wetMat.roughness=.27-W.env.wetness*.12;rm.opacity=rainLevel*.75;rainPoints.visible=rainLevel>.03;
    if(rainPoints.visible){rainPoints.position.copy(W.camera.position);rainPoints.position.y-=25;const a=rg.attributes.position.array;for(let i=0;i<rainCount;i++){a[i*3+1]-=(42+rainLevel*55)*dt;if(a[i*3+1]<-25){a[i*3+1]=75+Math.random()*35;a[i*3]=(Math.random()-.5)*180;a[i*3+2]=(Math.random()-.5)*180;}}rg.attributes.position.needsUpdate=true;}
  }
  function updateSky(){
    const envHour=Number(W.env?.timeOfDay),settingHour=Number(settings.time),sourceHour=Number.isFinite(envHour)?envHour:(Number.isFinite(settingHour)?settingHour:14.2),hour=((sourceHour%24)+24)%24,cloud=clamp(W.env?.cloud||0,0,1),rain=clamp(W.env?.rain||0,0,1),solar=Math.sin((hour-6)/12*Math.PI),day=clamp(solar*1.9+.08,0,1),night=1-day,twilightWindow=(hour>=4.5&&hour<=8)||(hour>=16&&hour<=20.2),twilight=twilightWindow?clamp(1-Math.abs(solar)*3.5,0,1):0;
    tmpTop.copy(nightTop).lerp(dayTop,day).lerp(sunsetTop,twilight*.72).lerp(storm,cloud*.32+rain*.28);tmpHorizon.copy(nightHorizon).lerp(dayHorizon,day).lerp(sunsetHorizon,twilight*(1-rain*.55)).lerp(storm,cloud*.40+rain*.34);tmpCloud.copy(cloudNight).lerp(cloudDay,day).lerp(storm,rain*.72);
    uniforms.uTop.value.copy(tmpTop);uniforms.uHorizon.value.copy(tmpHorizon);uniforms.uCloudColor.value.copy(tmpCloud);uniforms.uCloud.value=cloud;uniforms.uRain.value=rain;uniforms.uNight.value=night;uniforms.uTwilight.value=twilight;uniforms.uTime.value=R.race.t;
    const az=(hour/24*Math.PI*2)-Math.PI*.5,cy=Math.sqrt(Math.max(0,1-solar*solar));uniforms.uSunDir.value.set(Math.cos(az)*cy,solar,Math.sin(az)*cy).normalize();uniforms.uMoonDir.value.copy(uniforms.uSunDir.value).multiplyScalar(-1);sky.position.copy(W.camera.position);backgroundColor.copy(tmpTop);
    if(W.scene.fog)W.scene.fog.color.copy(tmpHorizon).lerp(storm,rain*.35);if(W.sun){W.sun.intensity=.10+2.62*day*(1-cloud*.45);W.sun.color.setRGB(1,.94-.18*twilight,.82-.28*twilight);}for(const h of hemis)h.light.intensity=.30+1.30*day*(1-cloud*.18);W.renderer.toneMappingExposure=.66+day*.34+twilight*.04-rain*.08;W.env.skyState={hour,day,night,twilight,cloud,rain};
  }
  function update(dt){updateBase(dt);radarClock+=dt;if(radarClock>=.5){radarClock=0;buildRadar();}updateSky();}
  buildRadar();updateSky();
  return{update,get weather(){return weather},get rain(){return rainLevel},get radar(){return radar},rainAt,get skyState(){return W.env.skyState},wetRoad,rainPoints};
}

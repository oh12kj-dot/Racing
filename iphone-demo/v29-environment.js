import {createEnvironment as createV26Environment} from './v26-environment.js';

export function createEnvironment(W,R,settings={}){
  const E=createV26Environment(W,R,settings),T=W.THREE,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const uniforms={
    uTop:{value:new T.Color(0x4389cc)},uHorizon:{value:new T.Color(0xc4d9e8)},uCloudColor:{value:new T.Color(0xe5eaed)},
    uSunDir:{value:new T.Vector3(0,1,0)},uMoonDir:{value:new T.Vector3(0,-1,0)},uCloud:{value:0},uRain:{value:0},uNight:{value:0},uTwilight:{value:0},uTime:{value:0}
  };
  const mat=new T.ShaderMaterial({
    side:T.BackSide,depthWrite:false,depthTest:false,fog:false,toneMapped:false,uniforms,
    vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`
      precision mediump float;
      varying vec3 vDir;
      uniform vec3 uTop,uHorizon,uCloudColor,uSunDir,uMoonDir;
      uniform float uCloud,uRain,uNight,uTwilight,uTime;
      float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      void main(){
        vec3 d=normalize(vDir);
        float y=clamp(d.y*.98+.04,0.0,1.0);
        vec3 col=mix(uHorizon,uTop,pow(y,.48));
        float wave=.50+.17*sin(d.x*9.0+uTime*.013)+.16*sin(d.z*13.0-uTime*.010)+.12*sin((d.x+d.z)*22.0+uTime*.006);
        float cloudBand=smoothstep(-.12,.08,d.y)*(1.0-smoothstep(.88,1.0,d.y));
        float cloudMask=smoothstep(.72-uCloud*.42,.90-uCloud*.18,wave)*cloudBand*clamp(uCloud*1.55,0.0,1.0);
        col=mix(col,uCloudColor,cloudMask*(.58+uRain*.30));
        float sunDot=dot(d,normalize(uSunDir));
        float sun=smoothstep(.9987,.99975,sunDot);
        float glow=smoothstep(.965,.9995,sunDot)*(.24+.34*uTwilight);
        vec3 sunCol=mix(vec3(1.0,.91,.70),vec3(1.0,.35,.10),uTwilight);
        col+=sunCol*(sun*1.30+glow*.28)*(1.0-cloudMask*.82)*(1.0-uRain*.72)*(1.0-uNight);
        float moonDot=dot(d,normalize(uMoonDir));
        float moon=smoothstep(.99915,.99978,moonDot)*uNight;
        col+=vec3(.66,.77,1.0)*moon*(1.0-cloudMask*.75);
        vec3 cell=floor((d+1.0)*520.0);
        float stars=step(.9978,hash3(cell))*uNight*smoothstep(.02,.22,d.y)*(1.0-cloudMask)*(1.0-uRain);
        col+=vec3(.80,.88,1.0)*stars*1.5;
        float hz=exp(-abs(d.y)*13.0)*uTwilight;
        col+=vec3(.85,.16,.045)*hz*(1.0-uRain*.72)*.42;
        col*=1.0-uRain*.13;
        gl_FragColor=vec4(col,1.0);
      }`
  });
  const sky=new T.Mesh(new T.SphereGeometry(1550,36,20),mat);sky.name='V29_DYNAMIC_SKY';sky.renderOrder=-10000;sky.frustumCulled=false;W.scene.add(sky);
  const hemis=[];W.scene.traverse(o=>{if(o.isHemisphereLight)hemis.push({light:o,base:o.intensity});});
  const dayTop=new T.Color(0x3788d0),dayHorizon=new T.Color(0xbfd9ec),nightTop=new T.Color(0x020611),nightHorizon=new T.Color(0x111a31),sunsetTop=new T.Color(0x2f426f),sunsetHorizon=new T.Color(0xff8052),storm=new T.Color(0x4d5961),cloudDay=new T.Color(0xe7ebed),cloudNight=new T.Color(0x252d37);
  const tmpTop=new T.Color(),tmpHorizon=new T.Color(),tmpCloud=new T.Color();

  function updateSky(){
    const envHour=Number(W.env?.timeOfDay),settingHour=Number(settings.time),sourceHour=Number.isFinite(envHour)?envHour:(Number.isFinite(settingHour)?settingHour:14.2);
    const hour=((sourceHour%24)+24)%24,cloud=clamp(W.env?.cloud||0,0,1),rain=clamp(W.env?.rain||0,0,1);
    const solar=Math.sin((hour-6)/12*Math.PI),day=clamp(solar*1.9+.08,0,1),night=1-day;
    const twilightWindow=(hour>=4.5&&hour<=8.0)||(hour>=16.0&&hour<=20.2),twilight=twilightWindow?clamp(1-Math.abs(solar)*3.5,0,1):0;
    tmpTop.copy(nightTop).lerp(dayTop,day).lerp(sunsetTop,twilight*.72).lerp(storm,cloud*.32+rain*.28);
    tmpHorizon.copy(nightHorizon).lerp(dayHorizon,day).lerp(sunsetHorizon,twilight*(1-rain*.55)).lerp(storm,cloud*.40+rain*.34);
    tmpCloud.copy(cloudNight).lerp(cloudDay,day).lerp(storm,rain*.72);
    uniforms.uTop.value.copy(tmpTop);uniforms.uHorizon.value.copy(tmpHorizon);uniforms.uCloudColor.value.copy(tmpCloud);
    uniforms.uCloud.value=cloud;uniforms.uRain.value=rain;uniforms.uNight.value=night;uniforms.uTwilight.value=twilight;uniforms.uTime.value=R.race.t;
    const az=(hour/24*Math.PI*2)-Math.PI*.5,cy=Math.sqrt(Math.max(0,1-solar*solar));
    uniforms.uSunDir.value.set(Math.cos(az)*cy,solar,Math.sin(az)*cy).normalize();uniforms.uMoonDir.value.copy(uniforms.uSunDir.value).multiplyScalar(-1);
    sky.position.copy(W.camera.position);
    W.scene.background=tmpTop.clone();
    if(W.scene.fog)W.scene.fog.color.copy(tmpHorizon).lerp(storm,rain*.35);
    if(W.sun){W.sun.intensity=.10+2.62*day*(1-cloud*.45);W.sun.color.setRGB(1,.94-.18*twilight,.82-.28*twilight);}
    for(const h of hemis)h.light.intensity=.30+1.30*day*(1-cloud*.18);
    W.renderer.toneMappingExposure=.66+day*.34+twilight*.04-rain*.08;
    W.env.skyState={hour,day,night,twilight,cloud,rain};
  }

  const baseUpdate=E.update;
  function update(dt){baseUpdate(dt);updateSky();}
  updateSky();
  return new Proxy(E,{get(target,prop){if(prop==='update')return update;if(prop==='skyState')return W.env.skyState;return Reflect.get(target,prop,target);}});
}

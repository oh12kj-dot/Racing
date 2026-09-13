export function createEnvironmentReflections(W,{mobile=false}={}){
  const T=W.THREE,size=mobile?256:512,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size>>1;const g=canvas.getContext('2d');
  const tex=new T.CanvasTexture(canvas);tex.mapping=T.EquirectangularReflectionMapping;tex.colorSpace=T.SRGBColorSpace;tex.generateMipmaps=true;
  let lastKey='';
  function paint(){
    const sky=W.env?.skyState||{},day=Math.max(0,Math.min(1,Number(sky.day??1))),tw=Math.max(0,Math.min(1,Number(sky.twilight??0))),rain=Math.max(0,Math.min(1,Number(W.env?.rain)||0)),cloud=Math.max(0,Math.min(1,Number(W.env?.cloud)||0)),hour=Number(sky.hour??W.env?.timeOfDay??14.2);
    const key=[Math.round(day*12),Math.round(tw*12),Math.round(rain*10),Math.round(cloud*10),Math.round(hour*2)].join(':');if(key===lastKey)return false;lastKey=key;
    const w=canvas.width,h=canvas.height,top=new T.Color(0x0a1730).lerp(new T.Color(0x4b93d4),day).lerp(new T.Color(0x44526e),cloud*.45),hz=new T.Color(0x20283a).lerp(new T.Color(0xc8ddec),day).lerp(new T.Color(0xff9468),tw*.72).lerp(new T.Color(0x69747b),rain*.52),ground=new T.Color(0x121619).lerp(new T.Color(0x4a5148),day*.62).lerp(new T.Color(0x262a2c),rain*.65);
    const toCss=c=>`#${c.getHexString()}`,gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,toCss(top));gr.addColorStop(.48,toCss(hz));gr.addColorStop(.57,toCss(hz.clone().multiplyScalar(.74)));gr.addColorStop(1,toCss(ground));g.fillStyle=gr;g.fillRect(0,0,w,h);
    const sunY=h*(.45-(Math.sin((hour-6)/12*Math.PI))*.30),sunX=((hour/24+.20)%1)*w,r=8+day*15;g.globalAlpha=(1-cloud*.72)*(1-rain*.72)*day;const glow=g.createRadialGradient(sunX,sunY,0,sunX,sunY,r*5);glow.addColorStop(0,'rgba(255,244,210,.95)');glow.addColorStop(.18,'rgba(255,210,145,.55)');glow.addColorStop(1,'rgba(255,180,100,0)');g.fillStyle=glow;g.fillRect(sunX-r*5,sunY-r*5,r*10,r*10);g.globalAlpha=1;
    if(cloud>.12){g.globalAlpha=.08+.18*cloud;g.fillStyle='#e8ecee';for(let i=0;i<18;i++){const x=(i*97%w),y=h*(.15+((i*37)%26)/100),rw=32+((i*53)%90),rh=6+((i*29)%16);g.beginPath();g.ellipse(x,y,rw,rh,0,0,Math.PI*2);g.fill();}g.globalAlpha=1;}
    tex.needsUpdate=true;W.scene.environment=tex;if('environmentIntensity' in W.scene)W.scene.environmentIntensity=.82+day*.20+rain*.16;return true;
  }
  paint();
  W.runtimeReflections={texture:tex,paint,get key(){return lastKey}};
  return W.runtimeReflections;
}

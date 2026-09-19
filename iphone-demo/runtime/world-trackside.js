import {buildWorld as buildV14World} from './v14-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV14World(THREE,TRACK,settings,circuitName),root=new THREE.Group();root.name='TRACKSIDE_V15';W.scene.add(root);
  const orange=new THREE.MeshStandardMaterial({color:0xff6b16,roughness:.75}),dark=new THREE.MeshStandardMaterial({color:0x202429,roughness:.7}),skin=new THREE.MeshStandardMaterial({color:0xd1a07b,roughness:.9});
  const flagM=new THREE.MeshBasicMaterial({color:0x45d56b,side:THREE.DoubleSide}),yellowM=new THREE.MeshBasicMaterial({color:0xffdf31,side:THREE.DoubleSide}),blueM=new THREE.MeshBasicMaterial({color:0x3485ff,side:THREE.DoubleSide});
  const checkCanvas=document.createElement('canvas');checkCanvas.width=132;checkCanvas.height=80;const cg=checkCanvas.getContext('2d');for(let y=0;y<4;y++)for(let x=0;x<6;x++){cg.fillStyle=(x+y)%2?'#fff':'#111';cg.fillRect(x*22,y*20,22,20);}const checkTex=new THREE.CanvasTexture(checkCanvas),checkM=new THREE.MeshBasicMaterial({map:checkTex,side:THREE.DoubleSide});
  const marshals=[],spectators=[],trackPts=[];for(let i=0;i<620;i++){const p=W.sample(W.total*i/620).p;trackPts.push([p.x,p.z]);}
  const minDistSq=(x,z)=>{let best=Infinity;for(const p of trackPts){const dx=x-p[0],dz=z-p[1],d=dx*dx+dz*dz;if(d<best)best=d;}return best;};
  function safePose(s,sign,base){for(let o=base;o<=48;o+=3){const q=W.sample(s,sign*o);if(minDistSq(q.p.x,q.p.z)>12.5*12.5)return q;}return null;}
  function person(mat,scale=1){const g=new THREE.Group(),b=new THREE.Mesh(new THREE.BoxGeometry(.30,.62,.22),mat),h=new THREE.Mesh(new THREE.SphereGeometry(.14,7,6),skin);b.position.y=.48;h.position.y=.91;g.add(b,h);g.scale.setScalar(scale);return g;}
  for(let i=0;i<14;i++){
    const s=W.total*(.025+i/14),sign=i%2?1:-1,q=safePose(s,sign,18+(i%3)*4);if(!q)continue;const g=new THREE.Group();g.position.copy(q.p);g.position.y+=.1;g.rotation.y=Math.atan2(q.t.x,q.t.z);root.add(g);const m=person(orange);g.add(m);const pole=new THREE.Mesh(new THREE.BoxGeometry(.035,1.25,.035),dark);pole.position.set(.32,1.0,0);g.add(pole);const flag=new THREE.Mesh(new THREE.PlaneGeometry(.62,.38),flagM);flag.position.set(.62,1.48,0);g.add(flag);marshals.push({g,flag,seed:i});
  }
  for(let c=0;c<9;c++){
    const s=W.total*(.06+c*.105),sign=c%2?1:-1,q=safePose(s,sign,27+(c%3)*5);if(!q)continue;const cluster=new THREE.Group();cluster.position.copy(q.p);cluster.rotation.y=Math.atan2(q.t.x,q.t.z);root.add(cluster);for(let j=0;j<12;j++){const mat=new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL((c*.13+j*.07)%1,.42,.48),roughness:.8}),p=person(mat,.92);p.position.set((j%4-1.5)*.65,0,Math.floor(j/4)*.52);cluster.add(p);spectators.push({p,seed:c*20+j});}}
  W.updateTrackside=(flag,race,standings=[])=>{const t=race?.t||0,lead=standings[0],final=lead&&lead.lap>=race.lapsTarget-1;for(const m of marshals){m.flag.material=final?checkM:(flag==='SC'||flag==='VSC'||flag==='YELLOW')?yellowM:flag==='BLUE'?blueM:flagM;m.flag.rotation.y=Math.sin(t*7+m.seed)*.16;m.flag.rotation.z=Math.sin(t*5+m.seed)*.10;}for(const s of spectators){const excite=final||flag==='GREEN';s.p.rotation.z=Math.sin(t*(excite?5:2)+s.seed)*(.06+(excite?.06:0));}};
  return W;
}

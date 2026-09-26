import * as THREE from 'three';

const modes=['AUTO','TV','FOLLOW','ONBOARD','PIT','HELI'];
export function createCameraDirector(world,track){
  const camera=new THREE.PerspectiveCamera(48,1,.1,1600);
  let mode='AUTO',trackedId=0,cutAt=0,autoMode='TV';
  function setMode(m){if(modes.includes(m))mode=m;}
  function cycleTracked(delta,cars){const alive=cars.filter(c=>!c.retired);const i=Math.max(0,alive.findIndex(c=>c.id===trackedId));trackedId=alive[(i+delta+alive.length)%alive.length]?.id??0;}
  function chooseAuto(snapshot){
    if(snapshot.time<cutAt)return;cutAt=snapshot.time+5.5;
    const battles=[];
    for(let i=0;i<snapshot.order.length-1;i++){const a=snapshot.order[i],b=snapshot.order[i+1];let d=a.s-b.s;if(d<0)d+=track.total;if(d<35)battles.push({id:b.id,d});}
    if(battles.length){trackedId=battles.sort((a,b)=>a.d-b.d)[0].id;autoMode=Math.random()<.62?'TV':'FOLLOW';}
    else{trackedId=snapshot.leader?.id??0;autoMode='TV';}
  }
  function update(snapshot){
    if(mode==='AUTO')chooseAuto(snapshot);
    const use=mode==='AUTO'?autoMode:mode;
    const car=snapshot.cars.find(c=>c.id===trackedId)??snapshot.leader;if(!car)return;
    const q=track.sample(car.s,car.lane),f=new THREE.Vector3(q.tx,0,q.tz),side=new THREE.Vector3(q.nx,0,q.nz),carPos=new THREE.Vector3(q.x,1.0,q.z);
    const bodyHeading=Number.isFinite(car.yaw)?car.yaw:q.heading;
    const bodyForward=new THREE.Vector3(Math.sin(bodyHeading),0,Math.cos(bodyHeading));
    let pos,target=carPos.clone();
    if(use==='FOLLOW'){pos=carPos.clone().addScaledVector(f,-12).add(new THREE.Vector3(0,5.2,0)).addScaledVector(side,2.2);target.addScaledVector(f,11);}
    else if(use==='ONBOARD'){
      pos=carPos.clone().add(new THREE.Vector3(0,1.35,0)).addScaledVector(bodyForward,.7);
      target=pos.clone().addScaledVector(bodyForward,28).add(new THREE.Vector3(0,-.7,0));
    }
    else if(use==='PIT'){const p=track.sample(track.pit.boxStart+30,track.pit.workingLane-9);pos=new THREE.Vector3(p.x,7,p.z);target=new THREE.Vector3(q.x,1,q.z);}
    else if(use==='HELI'){pos=carPos.clone().add(new THREE.Vector3(0,45,0)).addScaledVector(f,-10);target=carPos;}
    else{const anchor=track.sample(car.s+55,(car.id%2?1:-1)*28);pos=new THREE.Vector3(anchor.x,10+(car.id%3)*2,anchor.z);target=carPos.clone().addScaledVector(f,8);}
    if(use==='ONBOARD')camera.position.copy(pos);else camera.position.lerp(pos,.09);
    camera.lookAt(target);return{mode:use,tracked:car};
  }
  function resize(w,h){camera.aspect=Math.max(.1,w/Math.max(1,h));camera.updateProjectionMatrix();}
  return{camera,setMode,cycleTracked,update,resize,get mode(){return mode;},get trackedId(){return trackedId;},set trackedId(v){trackedId=v;}};
}

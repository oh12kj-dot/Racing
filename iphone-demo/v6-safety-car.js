export function createSafetyCar(W,R){
 const mesh=W.makeCar(0xffc400,'gt');
 mesh.visible=false;W.scene.add(mesh);
 function update(){
  if(R.flag!=='SC'){mesh.visible=false;return;}
  const leader=R.getStandings()[0];if(!leader){mesh.visible=false;return;}
  const q=W.sample(leader.s+34,0);mesh.visible=true;mesh.position.copy(q.p);mesh.position.y+=.12;mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
 }
 return{update,mesh};
}

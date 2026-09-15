export function atlasRuntimeCanvasTextures(W){
  const T=W.THREE,root=W.scene?.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');if(!T||!root||typeof document==='undefined')return{groups:0,texturesBefore:0,texturesAfter:0,meshes:0};
  const groups=new Map();root.traverse?.(o=>{if(!o?.isMesh||Array.isArray(o.material)||!o.material?.map?.isCanvasTexture||!o.material.map.image)return;const image=o.material.map.image,w=Number(image.width)||0,h=Number(image.height)||0;if(!w||!h)return;const key=`${o.material.type}|${o.material.side}|${w}x${h}`;let a=groups.get(key);if(!a)groups.set(key,a=[]);a.push(o);});
  let atlasGroups=0,texturesBefore=0,texturesAfter=0,meshes=0;
  for(const list of groups.values()){
    if(list.length<3)continue;const first=list[0],tileW=first.material.map.image.width,tileH=first.material.map.image.height,cols=Math.ceil(Math.sqrt(list.length)),rows=Math.ceil(list.length/cols),canvas=document.createElement('canvas');canvas.width=tileW*cols;canvas.height=tileH*rows;const g=canvas.getContext('2d');if(!g)continue;
    for(let i=0;i<list.length;i++){const col=i%cols,row=Math.floor(i/cols);g.drawImage(list[i].material.map.image,col*tileW,row*tileH,tileW,tileH);}const tex=new T.CanvasTexture(canvas);tex.colorSpace=first.material.map.colorSpace;tex.wrapS=first.material.map.wrapS;tex.wrapT=first.material.map.wrapT;tex.magFilter=first.material.map.magFilter;tex.minFilter=first.material.map.minFilter;tex.anisotropy=first.material.map.anisotropy;tex.needsUpdate=true;const mat=first.material.clone();mat.map=tex;mat.needsUpdate=true;
    for(let i=0;i<list.length;i++){const mesh=list[i],oldGeo=mesh.geometry,oldMat=mesh.material,oldMap=oldMat.map,col=i%cols,row=Math.floor(i/cols),geo=new T.BufferGeometry().copy(oldGeo),uv=geo.attributes.uv;if(!uv)continue;const arr=new Float32Array(uv.array.length);for(let j=0;j<uv.count;j++){arr[j*2]=(col+uv.getX(j))/cols;arr[j*2+1]=(rows-1-row+uv.getY(j))/rows;}geo.setAttribute('uv',new T.BufferAttribute(arr,2));geo.userData.runtimeAtlas=true;mesh.geometry=geo;mesh.material=mat;oldGeo?.dispose?.();oldMap?.dispose?.();oldMat?.dispose?.();texturesBefore++;meshes++;}
    atlasGroups++;texturesAfter++;
  }
  return{owner:'runtime-canvas-atlas-v1',groups:atlasGroups,texturesBefore,texturesAfter,meshes};
}

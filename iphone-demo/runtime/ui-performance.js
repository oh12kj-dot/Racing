import {createUI as createBaseUI} from './ui.js';

export function createUI(W,R,D,E,C,A,settings,saveSettings){
  const U=createBaseUI(W,R,D,E,C,A,settings,saveSettings),baseUpdate=U.update;
  let acc=0,lastFocus=0,updates=0,skipped=0;
  const hz=12,step=1/hz;
  function update(dt,id){
    lastFocus=Number.isFinite(Number(id))?Number(id):lastFocus;acc+=Math.max(0,Number(dt)||0);
    if(acc<step){skipped++;return;}
    const elapsed=Math.min(.5,acc);acc=0;updates++;return baseUpdate(elapsed,lastFocus);
  }
  W.runtimeUIBudget={owner:'runtime-ui-budget-v1',hz,updates,skipped};
  return new Proxy(U,{get(target,prop){
    if(prop==='update')return(dt,id)=>{const r=update(dt,id);W.runtimeUIBudget={owner:'runtime-ui-budget-v1',hz,updates,skipped};return r;};
    if(prop==='performanceBudget')return{owner:'runtime-ui-budget-v1',hz,updates,skipped};
    return Reflect.get(target,prop,target);
  }});
}

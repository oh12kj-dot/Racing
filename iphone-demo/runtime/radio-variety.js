export function createRadioVariety(R){
  const seen=new Set(),cursor=new Map(),recent=[];
  const metrics={processed:0,rewritten:0,byCategory:{}};
  const pushRecent=(m,category,before)=>{recent.push({t:R.race?.t||0,id:m.id,carId:m.carId??null,kind:m.kind||'',category,before,after:m.text});while(recent.length>40)recent.shift();};
  function next(key,items){const i=cursor.get(key)||0;cursor.set(key,i+1);return items[i%items.length];}
  function choose(car,category,items){return next(`${car?.id??'global'}:${category}`,items);}
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const sentence=s=>{s=clean(s);return s?s[0].toUpperCase()+s.slice(1):'';};
  const stripDot=s=>clean(s).replace(/[. ]+$/,'');

  function strategy(car,text){
    const t=text.toLowerCase();
    if(/box this lap|\bbox\b/.test(t)){
      const m=text.match(/box this lap\.?\s*(.*)$/i),reason=stripDot(m?.[1]||'');
      const tail=reason?` ${sentence(reason)}.`:'';
      return choose(car,'STRATEGY_BOX',[
        `Box, box this lap.${tail}`,
        `Pit this lap. Confirm box.${tail}`,
        `We are boxing at the end of this lap.${tail}`,
        `Box this lap, box this lap.${tail}`,
        `Come in this lap. Pit entry confirmed.${tail}`
      ]);
    }
    if(/push|gap ahead|attack/.test(t))return choose(car,'STRATEGY_PUSH',[
      'Target plus one. Push now and use the available energy.',
      'We need the lap time now. Push, but keep the exits clean.',
      'Attack phase. You are free to use the tyres and energy.',
      'Close the gap this lap. Full pace where it is safe.',
      'This is the push lap. Use the battery and commit on exit.'
    ]);
    if(/save|fuel|lift/.test(t))return choose(car,'STRATEGY_SAVE',[
      'Switch to save mode. Lift and coast into the heavy braking zones.',
      'Fuel target is tight. Give us a little more lift and coast.',
      'Manage fuel for now. Short shift where you can.',
      'Energy and fuel saving phase. Keep the lap tidy.',
      'We need conservation for a few laps. Prioritise clean exits.'
    ]);
    return text;
  }

  function tyreEngineer(car,text){
    const t=text.toLowerCase();
    if(/temperature|temps|cool/.test(t))return choose(car,'TYRE_TEMP',[
      'Tyre temperatures are rising. Find clean air and cool them on the straights.',
      'We are hot on the tyres. Back out of the dirty air where possible.',
      'Temps are above target. Cool the car without giving away the gap.',
      'Thermals are high. Use the straights to get some air through the tyres.',
      'Tyre temperature warning. Protect the fronts for the next sector.'
    ]);
    if(/graining/.test(t))return choose(car,'TYRE_GRAIN',[
      'We can see graining on the front axle. Keep the steering inputs smooth.',
      'Front graining is building. Clean the tyres up and avoid sliding them.',
      'The fronts are starting to grain. Be patient on turn-in.',
      'Graining is visible. Reduce scrub and let the surface recover.',
      'Manage the front tyres for a lap. We think the graining can clear.'
    ]);
    if(/blister/.test(t))return choose(car,'TYRE_BLISTER',[
      'Rear blistering is increasing. Protect traction on corner exit.',
      'We are seeing blistering. Avoid wheelspin and keep the rears under control.',
      'Rear surface temperature is too high. Be gentle on power application.',
      'Blistering warning. Prioritise traction management for the next lap.',
      'Protect the rear tyres. We are close to the blistering limit.'
    ]);
    if(/rain|wet tyre|wet tyre|crossover/.test(t))return choose(car,'WEATHER',[
      'Rain is increasing. We are approaching the crossover for wets.',
      'Grip is moving toward the wet tyre. Keep us updated on the surface.',
      'More rain expected shortly. Be ready for a tyre call.',
      'The wet crossover is getting close. Report standing water if you see it.',
      'Weather update: rain is building. We are watching the tyre delta.'
    ]);
    return text;
  }

  function driver(car,text){
    const t=text.toLowerCase();
    if(/box|boxing/.test(t))return choose(car,'DRIVER_BOX',[
      'Copy. Boxing this lap.',
      'Understood. I am coming in this lap.',
      'Box confirmed. I will hit the marks.',
      'Copy that. Preparing for pit entry.',
      'Understood, box this lap. Give me traffic on exit.'
    ]);
    if(/push|pushing|pace/.test(t))return choose(car,'DRIVER_PUSH',[
      'Copy. Pushing now.',
      'Understood. I have more pace available.',
      'Copy. I will use the energy this lap.',
      'Pushing. The balance is good enough to attack.',
      'Understood. I will maximise this lap.'
    ]);
    if(/grip|rain|wet/.test(t))return choose(car,'DRIVER_GRIP',[
      'Grip is dropping, especially on corner entry.',
      'The surface is getting slippery. I can feel more standing water.',
      'Copy. Rear grip is the main limitation right now.',
      'Understood. I can stay out, but the grip is getting marginal.',
      'The track is changing quickly. I will keep you updated.'
    ]);
    if(/tyre|temperature|temps|grain|blister/.test(t))return choose(car,'DRIVER_TYRE',[
      'Copy. I will look after the tyres.',
      'Understood. I will reduce the sliding.',
      'Copy. I can manage them for a few laps.',
      'The fronts are the limitation. I will clean them up.',
      'Understood. I will protect traction and bring the temperatures down.'
    ]);
    if(/gap|traffic/.test(t))return choose(car,'DRIVER_GAP',[
      'Copy. Keep me updated on the gap.',
      'Understood. Tell me if the car behind closes.',
      'Copy. I need the traffic picture before the stop.',
      'Okay. Give me the gap again at the end of the sector.',
      'Understood. Keep feeding me the gap.'
    ]);
    return choose(car,'DRIVER_ACK',[
      'Copy, I understand.',
      'Understood.',
      'Copy that.',
      'Okay, understood.',
      'Received. I am on it.',
      'Yep, copy.'
    ]);
  }

  function engineerReply(car,text){
    const t=text.toLowerCase(),gap=text.match(/gap behind\s+([0-9.]+)\s*seconds?/i)?.[1];
    if(gap)return choose(car,'ENGINEER_GAP',[
      `Gap behind is ${gap} seconds. Pit exit should be clear.`,
      `You have ${gap} seconds to the car behind. We are happy with the pit window.`,
      `Gap behind, ${gap} seconds. No immediate traffic concern.`,
      `${gap} seconds behind. You are clear to commit to the stop.`,
      `Traffic update: ${gap} seconds back. Pit exit looks clean.`
    ]);
    if(/stay out|reassess/.test(t))return choose(car,'ENGINEER_STAYOUT',[
      'Understood. Stay out for now. We will reassess at sector three.',
      'Copy. Remain on track. We will review the weather at the next split.',
      'Stay out confirmed. We will make the next call before pit entry.',
      'Understood. No stop this lap. We will reassess shortly.',
      'Copy that. Extend this stint and keep us updated on grip.'
    ]);
    return choose(car,'ENGINEER_REPLY',[
      'Copy. Keep it tidy and stay on plan.',
      'Understood. The numbers look good from here.',
      'Copy that. Continue with the current target.',
      'Good. Keep the rhythm and avoid unnecessary tyre slip.',
      'Understood. We are happy with the pace for now.'
    ]);
  }

  function control(text){
    const t=text.toLowerCase(),reason=stripDot(text.split('·').slice(1).join('·'));
    if(t.includes('red flag'))return next('GLOBAL:RED_FLAG',[
      `Red flag. ${reason||'Session stopped'}. Return safely to the pits.`,
      `Red flag, red flag. ${reason||'Session stopped'}. Reduce speed and return to pit lane.`,
      `Session suspended. ${reason||'Red flag conditions'}. Follow race control instructions.`
    ]);
    if(t.includes('safety car deployed'))return next('GLOBAL:SC',[
      `Safety car deployed. ${reason||'Incident on circuit'}. No overtaking.`,
      `Safety car, safety car. ${reason||'Incident ahead'}. Catch the delta safely.`,
      `Full safety car. ${reason||'Track obstruction'}. Maintain position and watch the delta.`
    ]);
    if(t.includes('vsc deployed'))return next('GLOBAL:VSC',[
      `Virtual safety car deployed. ${reason||'Incident on circuit'}. Observe the delta.`,
      `V S C active. ${reason||'Incident ahead'}. Slow to the required delta.`,
      `Virtual safety car. ${reason||'Track hazard'}. No overtaking and respect the delta.`
    ]);
    if(t.includes('green flag')||t.includes('track clear'))return next('GLOBAL:GREEN',[
      'Green flag. Track is clear and racing resumes.',
      'Track clear. Green flag conditions.',
      'Green flag. You are free to race.',
      'Race control confirms the circuit is clear. Green flag.'
    ]);
    return text;
  }

  function penalty(car,text){
    const m=text.match(/(\d+)\s*second penalty\.?(.*)$/i);if(!m)return text;const sec=m[1],reason=stripDot(m[2]||'');const tail=reason?` for ${reason}`:'';
    return choose(car,'PENALTY',[
      `${sec} second penalty${tail}.`,
      `Race control has given us a ${sec} second penalty${tail}.`,
      `We have a ${sec} second penalty${tail}. We will serve it at the next opportunity.`,
      `${sec} seconds added${tail}. Keep your head down and continue.`
    ]);
  }

  function pit(car,text){
    const t=text.toLowerCase();if(!/problem|hold position|wheel nut|jack|tyre delay|release hold/.test(t))return text;
    const issue=stripDot(text.replace(/problem\.?\s*hold position\.?/i,'').replace(/hold position\.?/i,''))||'pit stop issue';
    return choose(car,'PIT_PROBLEM',[
      `${sentence(issue)} problem. Hold the car.`,
      `Stand by. We have a ${issue.toLowerCase()} issue.`,
      `Hold position, hold position. ${sentence(issue)} problem.`,
      `Pit crew reports ${issue.toLowerCase()}. We need a few more seconds.`,
      `${sentence(issue)} issue. Stay on the brakes until release.`
    ]);
  }

  function rewrite(m){
    const before=clean(m.text);if(!before||/^radio check/i.test(before))return{category:'SKIP',text:before};const car=m.carId==null?null:R.cars?.[m.carId],kind=String(m.kind||'').toUpperCase();let out=before,category='OTHER';
    if(kind==='CONTROL'){category='CONTROL';out=control(before);}
    else if(kind==='DRIVER'){category='DRIVER';out=driver(car,before);}
    else if(kind==='ENGINEER_REPLY'){category='ENGINEER_REPLY';out=engineerReply(car,before);}
    else if(kind==='PENALTY'){category='PENALTY';out=penalty(car,before);}
    else if(kind==='PIT'||kind==='URGENT'){category='PIT';out=pit(car,before);if(out===before){const t=tyreEngineer(car,before);if(t!==before){out=t;category='ENGINEER';}}}
    else if(kind==='STRATEGY'){category='STRATEGY';out=strategy(car,before);}
    else if(['TYRE','ENGINEER','ENGINEER_AI'].includes(kind)){category='ENGINEER';out=tyreEngineer(car,before);if(out===before)out=strategy(car,before);}
    return{category,text:clean(out)};
  }

  function update(){
    const a=R.radio||[];
    for(const m of a){
      if(!m?.id||seen.has(m.id))continue;seen.add(m.id);metrics.processed++;const before=clean(m.text),r=rewrite(m);metrics.byCategory[r.category]=(metrics.byCategory[r.category]||0)+1;
      if(r.text&&r.text!==before){m.originalText=m.originalText||before;m.text=r.text;metrics.rewritten++;pushRecent(m,r.category,before);}
    }
    if(seen.size>500){const live=new Set(a.map(x=>x?.id).filter(Boolean));for(const id of seen)if(!live.has(id))seen.delete(id);}
  }
  function diagnostics(){return{owner:'runtime-radio-variety-v1',metrics:{...metrics,byCategory:{...metrics.byCategory}},recent:[...recent]};}
  return{update,diagnostics};
}

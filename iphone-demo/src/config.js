export const FIXED_DT = 1 / 60;
export const RACE_LAPS = 8;

const band=(low,mid,high)=>({low,mid,high});
export const VEHICLE_CLASSES = Object.freeze({
  formula:{label:'FORMULA',top:98.3,accel:band(11.6,9.5,5.4),brake:31.5,tyreMu:1.75,aeroLoadG70:2.70,aeroRefSpeed:70,laneChangeG:3.30,mass:768,wheelbase:3.40,length:5.63,width:2.00,pace:1.00,draftGain:.18,dirtyAirLoss:.22,gears:8},
  hyper:{label:'HYPER',top:97.7,accel:band(9.6,7.5,4.1),brake:24.5,tyreMu:1.48,aeroLoadG70:1.26,aeroRefSpeed:70,laneChangeG:2.55,mass:1030,wheelbase:3.10,length:5.10,width:2.00,pace:.84,draftGain:.15,dirtyAirLoss:.14,gears:7},
  lmh:{label:'LMH',top:97.2,accel:band(9.4,7.3,3.9),brake:24.2,tyreMu:1.48,aeroLoadG70:1.24,aeroRefSpeed:70,laneChangeG:2.55,mass:1030,wheelbase:3.10,length:5.10,width:2.00,pace:.835,draftGain:.15,dirtyAirLoss:.14,gears:7},
  proto:{label:'PROTO',top:90.7,accel:band(9.1,7.0,3.6),brake:22.8,tyreMu:1.52,aeroLoadG70:1.36,aeroRefSpeed:70,laneChangeG:2.62,mass:950,wheelbase:3.00,length:5.00,width:1.99,pace:.82,draftGain:.14,dirtyAirLoss:.12,gears:6},
  gt:{label:'GT',top:84.6,accel:band(7.4,5.6,2.7),brake:18.5,tyreMu:1.35,aeroLoadG70:.63,aeroRefSpeed:70,laneChangeG:1.95,mass:1300,wheelbase:2.85,length:4.95,width:2.02,pace:.74,draftGain:.12,dirtyAirLoss:.07,gears:6},
  supercar:{label:'SUPERCAR',top:83.33,accel:band(8.2,5.9,2.8),brake:17.2,tyreMu:1.23,aeroLoadG70:.49,aeroRefSpeed:70,laneChangeG:1.78,mass:1350,wheelbase:2.82,length:4.94,width:1.98,pace:.72,draftGain:.10,dirtyAirLoss:.05,gears:6},
  touring:{label:'TOURING',top:70.3,accel:band(6.2,4.5,2.0),brake:16.5,tyreMu:1.28,aeroLoadG70:.37,aeroRefSpeed:70,laneChangeG:1.70,mass:1265,wheelbase:2.68,length:4.55,width:1.95,pace:.67,draftGain:.09,dirtyAirLoss:.04,gears:6}
});

const roster=[
  ['formula','Apex GP',0xff3b30],['formula','Apex GP',0xff3b30],
  ['formula','Nova Racing',0x2f80ed],['formula','Nova Racing',0x2f80ed],
  ['hyper','Orion Works',0xffffff],['hyper','Orion Works',0xffffff],
  ['hyper','Valkyrie Sport',0x7d5fff],['hyper','Valkyrie Sport',0x7d5fff],
  ['lmh','Asterion',0x00d084],['lmh','Asterion',0x00d084],
  ['lmh','Helios',0xffb000],
  ['proto','Vector P2',0x00bcd4],['proto','Vector P2',0x00bcd4],
  ['proto','Cobalt P2',0x0066ff],['proto','Cobalt P2',0x0066ff],
  ['gt','Falcon GT',0xff6b00],['gt','Falcon GT',0xff6b00],
  ['gt','Emerald GT',0x2ecc71],['gt','Emerald GT',0x2ecc71],
  ['supercar','Redline',0xe53935],['supercar','Redline',0xe53935],
  ['supercar','Pacific',0x26a69a],
  ['touring','Metro TCR',0xffd54f],['touring','Metro TCR',0xffd54f]
];

export function buildEntrants(){
  const teamIndex=new Map();
  return roster.map(([type,team,color],id)=>{
    if(!teamIndex.has(team))teamIndex.set(team,teamIndex.size);
    return{
      id,
      number:String(11+id),
      name:`${team.split(' ')[0]} ${11+id}`,
      team,
      teamId:teamIndex.get(team),
      type,
      color,
      spec:VEHICLE_CLASSES[type],
      skill:.78+((id*17)%18)/100,
      aggression:.44+((id*13)%46)/100,
      consistency:.94+((id*7)%10)/100
    };
  });
}

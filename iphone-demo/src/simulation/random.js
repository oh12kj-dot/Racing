export function createRng(seed=0x6d2b79f5){
  let s=seed>>>0;
  return{
    next(){
      s=(Math.imul(s^(s>>>15),1|s)+0x6d2b79f5)>>>0;
      s=(s+Math.imul(s^(s>>>7),61|s))^s;
      return ((s^(s>>>14))>>>0)/4294967296;
    },
    range(a,b){return a+(b-a)*this.next();},
    signed(){return this.next()*2-1;}
  };
}

import { fetchCandles } from "../src/lib/metaapi/market.server";
for (const s of ["WTI","WTIB","WTID","WTIP","WTIU","USTEC"]) {
  try {
    const c: any = await fetchCandles(s, "H1", 60);
    const last = c.at(-1);
    const times = c.map((x:any)=>new Date(x.time).getTime());
    let gaps: string[] = [];
    for (let i=1;i<times.length;i++){const d=(times[i]-times[i-1])/60000; if(d>90) gaps.push(`${new Date(times[i-1]).toISOString().slice(5,16)}+${d}m`);}
    console.log(s.padEnd(6), "close", last?.close, "last", last?.time, "gaps", gaps.join(" "));
  } catch(e:any){ console.log(s, "ERR", e.message.slice(0,80)); }
}

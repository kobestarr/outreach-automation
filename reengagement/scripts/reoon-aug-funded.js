const fs=require("fs");
const R=require("../../shared/outreach-core/email-verification/reoon-verifier.js");
const SP="/private/tmp/claude-501/-Users-kobestarr-Development-One-Hour-Vibe-Coder-outreach-automation/f219787d-f6ca-44c9-b90e-1f28aa9b182b/scratchpad/aug-new.txt";
(async()=>{
  const emails=fs.readFileSync(SP,"utf8").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  console.log("verifying",emails.length,"emails via Reoon (safe-only target)...");
  const results=await R.verifyEmails(emails,"power");
  const arr=Array.isArray(results)?results:(results.results||[]);
  const tally={};const safe=[];
  for(const r of arr){const st=(r.status||r.result||"?").toLowerCase();tally[st]=(tally[st]||0)+1;if(/safe|valid|deliverable/.test(st)&&!/invalid|un/.test(st))safe.push(r.email);}
  fs.writeFileSync(__dirname+"/../data/funded-aug-reoon.json",JSON.stringify(arr,null,1));
  fs.writeFileSync(__dirname+"/../data/funded-aug-safe.txt",safe.join("\n"));
  console.log("TALLY:",JSON.stringify(tally));
  console.log("SAFE (sendable):",safe.length,"/",arr.length);
})().catch(e=>console.log("ERR",e.message));

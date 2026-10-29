const fs=require('fs');
const src=fs.readFileSync('public/i18n.js','utf8');
const lines=src.split(/\r?\n/);
const start=lines.findIndex(l=>/^const DICT = \{/.test(l));
const end=lines.findIndex(l=>/^const langOf =/.test(l));
const dictSrc=lines.slice(start,end).join('\n')+'\n; global.DICT=DICT;';
global.document={querySelector:()=>({content:''}),body:{dataset:{support:'support@example.com'}}};
global.host=()=> 'SonVuDev';
global.supportAddress=()=> 'support@example.com';
global.YEAR=new Date().getFullYear();
eval(dictSrc);
const keys=Object.keys(DICT.vi);
(async () => {
  let ok=0, fail=0, same=0;
  for (const k of keys) {
    const text = DICT.vi[k];
    try {
      const res = await fetch('http://localhost:3000/api/translate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text, target:'de', source:'vi'}) });
      if (!res.ok) { fail++; console.log('FAIL', res.status, k); continue; }
      const data = await res.json();
      const tr = data.translated;
      if (!tr || tr === text) { same++; }
      else ok++;
    } catch (e) { fail++; console.log('ERR', k, e.message); }
  }
  console.log('done: changed=', ok, 'same=', same, 'fail=', fail, 'total=', keys.length);
})();
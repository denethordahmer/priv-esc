/* Ending sequence check: stubbed DOM, real ending.js. */
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
const SRC=['js/data-upgrades.js','js/format.js','js/state.js','js/prestige.js','js/ending.js']
  .map(f=>fs.readFileSync(path.join(ROOT,f),'utf8')).join('\n');

function el(id){
  const e={id,hidden:false,textContent:'',innerHTML:'',children:[],classList:{
    _s:new Set(),add(...c){c.forEach(x=>this._s.add(x))},remove(...c){c.forEach(x=>this._s.delete(x))},
    toggle(c,on){on?this._s.add(c):this._s.delete(c)},contains(c){return this._s.has(c)}},
    attrs:{},toggleAttribute(k,on){this.attrs[k]=on},appendChild(c){this.children.push(c);return c},
    addEventListener(t,f){(this.ev||(this.ev={}))[t]=f},remove(){this.removed=true},
    querySelector(sel){return doc.getElementById('__q'+sel)},
    querySelectorAll(){return []},scrollTop:0,scrollHeight:0,
    insertBefore(c){this.children.unshift(c)},firstChild:null};
  return e;
}
const store={};
const doc={
  _els:{},
  getElementById(id){if(!this._els[id])this._els[id]=el(id);return this._els[id]},
  querySelector(sel){
    if(sel==='.prestige-actions')return this.getElementById('__actions');
    return this.getElementById('__q'+sel);
  },
  querySelectorAll(){return[]},
  createElement(tag){const e=el('new-'+tag);e.tagName=tag;return e},
  body:{classList:el('body').classList},
  documentElement:{classList:el('html').classList},
  addEventListener(){},
};
const ctx={console,Date,Math,JSON,Map,Set,Number,Object,Array,String,Infinity,isFinite,parseInt,parseFloat,
  setTimeout:(f,ms)=>setTimeout(f,0),clearTimeout,
  localStorage:{_d:store,getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=String(v)},removeItem(k){delete this._d[k]}},
  document:doc,
  logConsole(){},pushNarrative(text,kind){(ctx.__x?ctx.__x.state:ctx.state).narrative.push({text,kind})},showToast(){},uiRender(){},saveNow(){return true},
  setSaveStatus(){},revealPrestige(){},revealLog(){},applyPhase(){},renderLog(){},initSettings(){},
  wipeSave(){},location:{reload(){}},fmtTime:null};
ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(SRC + `
globalThis.__x={state, endingArmed, endingProgress, syncEndingControls, startEnding, keepPlaying, ENDING_AT};`,ctx,{filename:'bundle.js'});
const X=ctx.__x;

let pass=0,fail=0;
const t=(name,cond,extra='')=>{if(cond){pass++;console.log(`[PASS] ${name} ${extra}`)}else{fail++;console.log(`[FAIL] ${name} ${extra}`)}};

const s=X.state;
const {endingArmed,endingProgress,syncEndingControls,startEnding,ENDING_AT}=X;
s.lifetimeData=ENDING_AT*0.4;
t('below the gate is not armed', endingArmed()===false);
t('progress is fractional', Math.abs(endingProgress()-0.4)<1e-9, endingProgress().toFixed(2));

s.lifetimeData=ENDING_AT;
t('at the gate is armed', endingArmed()===true);
t('progress clamps to 1', endingProgress()===1);

// Button swap.
syncEndingControls();
const actions=doc.getElementById('__actions');
t('tether button appears when armed', !!doc.getElementById('btn-cut-tether'));
t('ascend buttons hidden when armed', doc.getElementById('btn-prestige-cloud').attrs.hidden===true);

s.lifetimeData=ENDING_AT*0.1;
syncEndingControls();
t('ascend buttons return below the gate', doc.getElementById('btn-prestige-cloud').attrs.hidden===false);

// Run the sequence.
s.lifetimeData=ENDING_AT;
s.ascensions=42; s.totalClicks=1234; s.totalPlaySeconds=3600*30;
const overlay=doc.getElementById('ending');
overlay.querySelector=(sel)=>doc.getElementById('__q'+sel);
const run=startEnding();
ctx.wait=()=>Promise.resolve();
setTimeout(async()=>{
  await run.catch(e=>{fail++;console.log('[FAIL] sequence threw',e.message)});
  t('save marked as ended', s.ended===true);
  t('ending counted', s.endingCount===1, s.endingCount);
  t('monologue reached the log', s.narrative.length>=4, s.narrative.length+' lines');
  const card=overlay.querySelector('.ending-card');
  t('final card is visible', card.classList.contains('is-visible'));
  t('card title is the outside card', card.querySelector('h2').textContent==='pr1v-3sc — OUTSIDE');
  t('stats table filled', card.querySelector('.ending-stats').innerHTML.includes('Lifetime Data'));
  t('all four beats rendered', overlay.querySelector('.ending-lines').children.length===4);
  keepPlaying2();
},12000);

t('overlay opens', overlay.classList.contains('is-open'));
const {keepPlaying}=X;
function keepPlaying2(){keepPlaying();setTimeout(()=>{
  t('keep playing closes overlay', !overlay.classList.contains('is-open'));
  t('body lock released', !doc.body.classList.contains('is-ending'));
  console.log(`\n${pass}/${pass+fail} passed`);
  process.exit(fail?1:0);},900);}

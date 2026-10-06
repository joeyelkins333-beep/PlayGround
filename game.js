/* Vale of Oaths — original harvest-sim + moral-choices prototype.
   ALL pixel art here is original work created for this project (16x16 sprite
   engine below). No Stardew Valley assets, sprites, or code are used — the look
   is merely inspired by the cozy top-down farm-sim genre.
   Phone/tablet first: virtual joystick + action button. Desktop: WASD + E.
*/
(() => {
"use strict";
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const TILE = 32;
const MW = 32, MH = 22; // world tiles
const W = MW*TILE, H = MH*TILE;

// ---------- utils ----------
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const rnd=(a,b)=>a+Math.random()*(b-a);
const irnd=(a,b)=>Math.floor(rnd(a,b+1));
const $=id=>document.getElementById(id);
function toast(msg,ms=2200){const t=document.createElement('div');t.className='toastmsg';t.textContent=msg;$('toast').appendChild(t);setTimeout(()=>t.remove(),ms);}
// deterministic 0..1 hash per tile — stable decoration, no per-frame flicker
function hash2(x,y){let h=(Math.imul(x,374761393)+Math.imul(y,668265263))|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296;}
function lcg(seed){let s=(seed>>>0)||1;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}

// ---------- audio (tiny beeps) ----------
let AC=null;
function beep(f=440,d=0.08,type='square',v=0.05){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();const o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.value=f;g.gain.value=v;o.connect(g);g.connect(AC.destination);o.start();g.gain.exponentialRampToValueAtTime(0.0001,AC.currentTime+d);o.stop(AC.currentTime+d);}catch(e){}}

// ---------- game state ----------
const CROPS={
  sunroot:{name:'Sunroot',seed:20,sell:65,days:3,color:'#ffcf3f',dark:'#d9a012',leaf:'#3fae4a',leafD:'#2e7d34'},
  moonberry:{name:'Moonberry',seed:55,sell:160,days:5,color:'#9d8bff',dark:'#6a58d8',leaf:'#2e9d5a',leafD:'#1f6b3a'},
  embermelon:{name:'Embermelon',seed:120,sell:340,days:7,color:'#ff7a3c',dark:'#c94a1a',leaf:'#35b06a',leafD:'#1f7a44'},
};
const TOOLS=[
  {id:'hoe',icon:'⛏️',name:'Hoe'},
  {id:'sunroot',icon:'🌱',name:'Sunroot seed'},
  {id:'moonberry',icon:'🫐',name:'Moonberry seed'},
  {id:'embermelon',icon:'🍈',name:'Embermelon seed'},
  {id:'water',icon:'💧',name:'Watering can'},
  {id:'sword',icon:'🗡️',name:'Blade'},
];
let S=null;
function newGame(){
  // 0 grass,1 path,2 water,3 house,4 shop,5 tree,6 rock,7 flowers,8 fence,9 tilled handled separately,10 bridge,11 plaza,12 heartstone
  const tiles=[];
  for(let y=0;y<MH;y++){const r=[];for(let x=0;x<MW;x++){
    let t=0;
    if(Math.random()<0.06)t=7;
    r.push(t);
  }tiles.push(r);}
  // pond west-north
  for(let y=3;y<8;y++)for(let x=2;x<7;x++)tiles[y][x]=2;
  tiles[5][7]=10;tiles[5][1]=10;
  // town plaza north-center
  for(let y=2;y<7;y++)for(let x=13;x<20;x++)if(tiles[y][x]!==2)tiles[y][x]=11;
  // house (player cottage) SW
  for(let y=13;y<16;y++)for(let x=4;x<8;x++)tiles[y][x]=3;
  // shop NE of plaza
  for(let y=3;y<5;y++)for(let x=21;x<24;x++)tiles[y][x]=4;
  // heartstone shrine center-north
  tiles[6][16]=12;tiles[6][15]=11;tiles[6][17]=11;
  // paths
  for(let x=3;x<26;x++)tiles[9][x]=1;
  for(let y=6;y<17;y++)tiles[16][y]!==undefined&&(tiles[y][16]=1);
  for(let y=9;y<14;y++)for(let x=6;x<17;x++)if(tiles[y][x]===0)tiles[y][x]=1;
  // forest / rocks east (wilds)
  for(let i=0;i<26;i++){tiles[irnd(8,20)][irnd(24,30)]=5;}
  for(let i=0;i<12;i++){tiles[irnd(10,19)][irnd(24,30)]=6;}
  // fences around farm
  for(let x=2;x<13;x++){tiles[11][x]=8;tiles[18][x]=8;}
  return {
    day:1,minute:8*60,gold:60,energy:100,hp:100,
    align:0,renown:0,tool:0,
    inv:{sunroot:2,moonberry:0,embermelon:0,goo:0,harvest_sunroot:0,harvest_moonberry:0,harvest_embermelon:0},
    px:10*TILE,py:12*TILE,face:1,moving:false,anim:0,
    farm:{}, // "x,y" -> {crop,dayPlanted,watered,grown}
    wateredToday:{},
    npcs:[
      {id:'mayor',name:'Mayor Bram',x:15*TILE,y:5*TILE,c:'#8b5a2b',q:'q1',talk:0},
      {id:'wren',name:'Wren (kid)',x:18*TILE,y:8*TILE,c:'#c94f7c',q:'q2',talk:0},
      {id:'sage',name:'Sage Odo',x:17*TILE,y:6*TILE,c:'#4fa3c9',q:'q3',talk:0},
    ],
    enemies:[{x:27*TILE,y:14*TILE,hp:30,t:0,hurt:0},{x:26*TILE,y:17*TILE,hp:30,t:2,hurt:0},{x:29*TILE,y:11*TILE,hp:50,t:4,hurt:0}],
    quests:{q1:0,q2:0,q3:0}, // 0 not started,1 active,2 done-good,3 done-evil
    toyX:29*TILE,toyY:18*TILE,toyTaken:false,
    heartDone:false,ended:false,
    tiles,
  };
}
function save(){try{localStorage.setItem('vale-of-oaths',JSON.stringify(S));}catch(e){}}
function load(){try{const s=localStorage.getItem('vale-of-oaths');if(!s)return null;return JSON.parse(s);}catch(e){return null;}}

// tile helpers
const key=(x,y)=>x+','+y;
function tileAt(px,py){const x=Math.floor(px/TILE),y=Math.floor(py/TILE);if(x<0||y<0||x>=MW||y>=MH)return 1;return S.tiles[y][x];}
function walkable(px,py){
  const t=tileAt(px,py);
  if(t===2||t===3||t===4||t===5||t===6||t===8||t===12)return false;
  return true;
}

// ---------- input: keyboard + joystick + tap ----------
const keys={};
addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true;if(e.key.toLowerCase()==='e')doAction();if(e.key===' ') {e.preventDefault();doAction();}});
addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
const joy={x:0,y:0,active:false};
(function(){
  const el=$('joy'),st=$('stick');let id=null;
  const set=(dx,dy)=>{joy.x=clamp(dx/40,-1,1);joy.y=clamp(dy/40,-1,1);st.style.transform=`translate(${clamp(dx,-38,38)}px,${clamp(dy,-38,38)}px)`;};
  el.addEventListener('pointerdown',e=>{id=e.pointerId;el.setPointerCapture(id);joy.active=true;move(e);});
  el.addEventListener('pointermove',e=>{if(e.pointerId===id)move(e);});
  const end=e=>{if(e.pointerId===id){id=null;joy.active=false;joy.x=joy.y=0;st.style.transform='';}};
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
  function move(e){const r=el.getBoundingClientRect();set(e.clientX-(r.left+r.width/2),e.clientY-(r.top+r.height/2));}
})();
$('btn-act').addEventListener('click',doAction);
$('btn-tool').addEventListener('click',cycleTool);
$('btn-sleep').addEventListener('click',()=>openSleep());
canvas.addEventListener('pointerdown',e=>{
  const r=canvas.getBoundingClientRect();
  const cx=(e.clientX-r.left)/r.width*canvas.width;
  const cy=(e.clientY-r.top)/r.height*canvas.height;
  const wx=cx+cam.x, wy=cy+cam.y;
  // talk if tapped npc
  for(const n of S.npcs){if(Math.hypot(n.x+TILE/2-wx,n.y+TILE/2-wy)<34){S.px=clamp(n.x-40,0,W);S.py=n.y;talkTo(n);return;}}
  // otherwise walk target short step toward tap
  const dx=wx-(S.px+TILE/2),dy=wy-(S.py+TILE/2);
  const d=Math.hypot(dx,dy);
  if(d>10){tapMove={x:dx/d,y:dy/d,t:30};}
  doActionAt(wx,wy);
});
let tapMove=null;

// ---------- camera ----------
const cam={x:0,y:0};

// ---------- time ----------
function fmtTime(){const h=Math.floor(S.minute/60),m=Math.floor(S.minute%60);return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
function advanceTime(min){
  S.minute+=min;
  if(S.minute>=24*60){sleep(true);}
  if(S.energy<=0){toast('😴 Exhausted! You collapse into bed…');sleep(true);}
}

// ---------- farming ----------
function farmKeyAt(px,py){return key(Math.floor(px/TILE),Math.floor(py/TILE));}
function doAction(){ // keyboard/button: act on facing tile
  const cx=S.px+TILE/2+S.face*26, cy=S.py+TILE/2;
  // npc in front?
  let best=null,bd=52;
  for(const n of S.npcs){const d=Math.hypot(n.x+TILE/2-(S.px+TILE/2),n.y+TILE/2-(S.py+TILE/2));if(d<bd){bd=d;best=n;}}
  if(best){talkTo(best);return;}
  // bed? (face the cottage to sleep) — sleep button 😴 also works anywhere
  const tx=Math.floor(cx/TILE),ty=Math.floor(cy/TILE);
  const facingHouse = S.tiles[ty]&&S.tiles[ty][tx]===3;
  if(facingHouse){openSleep();return;}
  // shop?
  if(S.tiles[ty]&&S.tiles[ty][tx]===4){openShop();return;}
  if(S.tiles[ty]&&S.tiles[ty][tx]===12){openHeart();return;}
  // toy pickup
  if(!S.toyTaken&&Math.hypot(S.toyX-S.px,S.toyY-S.py)<50){S.toyTaken=true;S.inv.toy=1;toast('🧸 Found Wren\'s wooden fox!');beep(660,0.12);save();return;}
  doActionAt(cx,cy);
}
function doActionAt(wx,wy){
  const tx=Math.floor(wx/TILE),ty=Math.floor(wy/TILE);
  if(tx<0||ty<0||tx>=MW||ty>=MH)return;
  const tool=TOOLS[S.tool].id;
  const k=key(tx,ty), f=S.farm[k];
  const base=S.tiles[ty][tx];
  // combat first: enemy near?
  for(let i=0;i<S.enemies.length;i++){const e=S.enemies[i];
    if(Math.hypot(e.x-wx,e.y-wy)<40){hitEnemy(i);return;}
  }
  if(tool==='sword'){ // swing, small aoe
    beep(200,0.08,'sawtooth',0.04);
    S.anim=10;advanceTime(5);
    let hit=false;
    for(let i=S.enemies.length-1;i>=0;i--){const e=S.enemies[i];if(Math.hypot(e.x-(S.px+TILE/2),e.y-(S.py+TILE/2))<70){hitEnemy(i);hit=true;}}
    if(!hit)toast('🗡️ Swish… (walk up to a slime)');
    return;
  }
  if(base===2||base===3||base===4||base===5||base===6||base===8||base===11||base===12){
    if(base===2){toast('💧 Pond water. Use your can near crops.');}
    return;
  }
  if(tool==='hoe'){
    if(!f){S.farm[k]={crop:null,planted:0,watered:false};S.energy-=2;beep(150,0.07);advanceTime(10);save();}
    else toast('Already tilled.');
  }else if(tool==='water'){
    if(f&&!f.watered){f.watered=true;S.energy-=2;beep(500,0.1,'sine');advanceTime(10);save();}
    else if(f&&f.watered)toast('Already watered.');
    else toast('Hoe the soil first (⛏️).');
  }else if(CROPS[tool]){
    const c=CROPS[tool];
    if(!f){toast('Hoe the soil first (⛏️).');return;}
    if(f.crop){toast('Something is already growing here.');return;}
    const seedKey=tool;
    if((S.inv[seedKey]||0)<=0){openShopBuySeed(tool);return;}
    S.inv[seedKey]--;f.crop=tool;f.planted=S.day;f.watered=false;S.energy-=2;beep(440,0.09);advanceTime(10);save();
  }
  // harvest check regardless of tool
  if(f&&f.crop){
    const c=CROPS[f.crop];
    const age=S.day-f.planted+(f.watered?0.4:0);
    if(age>=c.days){harvest(k,f);return;}
  }
  // hand harvest with any tool: if mature allow E again — handled above
}
function harvest(k,f){
  const id=f.crop;
  S.inv['harvest_'+id]=(S.inv['harvest_'+id]||0)+1;
  delete S.farm[k];
  S.energy-=1;beep(880,0.12);advanceTime(10);
  toast(`🌾 Harvested ${CROPS[id].name}! Sell at the shop (NE).`);
  // quest q1 progress
  if(S.quests.q1===1){const n=(S.inv.harvest_sunroot||0);if(n>=3)toast('✅ Quest: tell Mayor Bram the good news!');}
  save();
}
function hitEnemy(i){
  const e=S.enemies[i];
  e.hp-=irnd(12,22);e.hurt=0.45;S.anim=10;beep(180,0.1,'sawtooth',0.06);advanceTime(8);S.energy=Math.max(0,S.energy-3);
  // knockback
  e.x+=(e.x-S.px)*0.08;e.y+=(e.y-S.py)*0.08;
  if(e.hp<=0){S.enemies.splice(i,1);S.inv.goo=(S.inv.goo||0)+irnd(1,3);S.renown+=1;toast('💥 Slime poofed! +1 Renown, +goo (sellable). Good villagers cheer!');align(2,'You defended the vale (+Good).');beep(760,0.15);}
  updateHUD();save();
}
function align(d,why){S.align=clamp(S.align+d,-100,100);if(why)toast((d>0?'👼 +':'😈 ')+Math.abs(d)+' '+(d>0?'Good':'Shadow')+' — '+why);updateHUD();}

// ---------- dialog / quests ----------
function panel(title,body,choices){
  $('panel-title').textContent=title;
  $('panel-body').textContent=body;
  const c=$('panel-choices');c.innerHTML='';
  (choices||[]).forEach(ch=>{
    const b=document.createElement('button');
    b.textContent=ch.label;b.className=ch.cls||'';
    b.onclick=()=>{ch.fn&&ch.fn();if(ch.close!==false){}};c.appendChild(b);
  });
  $('panel').classList.remove('hidden');
}
$('panel-close').onclick=()=>$('panel').classList.add('hidden');

function talkTo(n){
  beep(520,0.07);
  if(n.id==='mayor'){
    if(S.quests.q1===0)panel('Mayor Bram 🎩',
      '“Traveler! Our Heartstone is dim. Prove you belong:\nharvest 3 Sunroots (hoe → plant → water → wait → harvest).\n\nWill you swear the Oath of Roots?”',
      [{label:'🌱 “I swear. I\'ll feed this vale.” (+Good)',cls:'good',fn:()=>{S.quests.q1=1;align(5);closePanel();toast('📜 Quest: harvest 3 Sunroots');save();}},
       {label:'😏 “What\'s in it for me, old man?”',fn:()=>{S.quests.q1=1;closePanel();toast('📜 Quest: harvest 3 Sunroots (no oath)');save();}}]);
    else if(S.quests.q1===1){
      const n2=S.inv.harvest_sunroot||0;
      if(n2>=3)panel('Mayor Bram 🎩',`“By the furrows! You did it — ${n2} Sunroots!”\nThe village watches. What will you do?`,
        [{label:'👼 Donate 3 Sunroots to the commons (+Good, +Renown)',cls:'good',fn:()=>{S.inv.harvest_sunroot-=3;S.gold+=20;S.renown+=2;S.quests.q1=2;align(12,'Fed the village.');closePanel();checkWin();save();}},
         {label:'😈 Lie: “Crows ate them.” Keep them to sell (+Shadow)',cls:'evil',fn:()=>{S.quests.q1=3;S.renown+=1;align(-12,'You lied to the Mayor.');closePanel();toast('You kept the harvest. Sell it for full price…');save();}}]);
      else panel('Mayor Bram 🎩',`“${n2}/3 Sunroots so far.\nBuy seeds at Marla's shop (NE, 🪙). Water daily — crops drink each morning.”`,[{label:'Understood.',fn:closePanel}]);
    } else panel('Mayor Bram 🎩','“The vale remembers your oath, '+(S.align>=20?'Brightblade':'traveler')+'.”',[{label:'Leave',fn:closePanel}]);
  }
  if(n.id==='wren'){
    if(S.quests.q2===0)panel('Wren 🧒','“Have you seen my wooden fox? I lost it in the EAST WOODS where the slimes live! I\'m scared…”',
      [{label:'👼 “Stay here. I\'ll brave the slimes.” (+Good)',cls:'good',fn:()=>{S.quests.q2=1;align(4);closePanel();toast('📜 Quest: find the wooden fox in the east woods');save();}},
       {label:'😈 “Finders keepers, kid.”',cls:'evil',fn:()=>{align(-4,'You mocked a child.');closePanel();save();}}]);
    else if(S.quests.q2===1){
      if(S.inv.toy)panel('Wren 🧒','“THAT\'S HIM! Mr. Fox! Did you… bring him back?”',
        [{label:'👼 Return it free (+Good, +Renown)',cls:'good',fn:()=>{delete S.inv.toy;S.quests.q2=2;S.renown+=2;align(12,'A hero to children.');closePanel();checkWin();save();}},
         {label:'😈 “50 gold and he\'s yours.” (extort)',cls:'evil',fn:()=>{if(S.inv.toy){delete S.inv.toy;S.gold+=50;S.quests.q2=3;align(-14,'You shook down a child.');closePanel();checkWin();save();}}},
         {label:'Keep it (walk away)',fn:closePanel}]);
      else panel('Wren 🧒','“It\'s in the east woods… past the big rocks. Watch for slimes! (Equip 🗡️ and tap ACT.)”',[{label:'I\'ll look.',fn:closePanel}]);
    } else panel('Wren 🧒',S.quests.q2===2?'“Mr. Fox says you\'re the NICEST! Wen I grow up I wanna be like you!”':'“Mom says I shouldn\'t talk to you…”',[{label:'Bye',fn:closePanel}]);
  }
  if(n.id==='sage'){
    if(!S.heartDone)panel('Sage Odo 🔮','“The Heartstone (plaza center) can bloom again:\nbring 1000 gold AND 6 Renown…\n…or take my shortcut: steal the UnderShard from the pond at midnight. Quick. Dark.”',
      [{label:'👼 “I\'ll earn it honestly.”',cls:'good',fn:()=>{S.quests.q3=1;align(4);closePanel();save();}},
       {label:'😈 “Tell me about the… shortcut.”',cls:'evil',fn:()=>{S.quests.q3=1;align(-6,'You listened to the dark plan.');closePanel();toast('🌙 Visit the pond after 21:00 and ACT to steal the shard.');save();}}]);
    else panel('Sage Odo 🔮','“The stone hums. The vale is healed.”',[{label:'…',fn:closePanel}]);
  }
}
function closePanel(){$('panel').classList.add('hidden');updateHUD();}

// ---------- shop / sleep / heart ----------
function priceMult(){if(S.align>=20)return 0.85;if(S.align<=-20)return 1.25;return 1;}
function openShop(){
  const m=priceMult();
  const rows=[
    ['Sunroot seed',Math.round(CROPS.sunroot.seed*m),'sunroot','buy'],
    ['Moonberry seed',Math.round(CROPS.moonberry.seed*m),'moonberry','buy'],
    ['Embermelon seed',Math.round(CROPS.embermelon.seed*m),'embermelon','buy'],
    ['Sell Sunroot (+'+CROPS.sunroot.sell+'g)',CROPS.sunroot.sell,'harvest_sunroot','sell'],
    ['Sell Moonberry (+'+CROPS.moonberry.sell+'g)',CROPS.moonberry.sell,'harvest_moonberry','sell'],
    ['Sell Embermelon (+'+CROPS.embermelon.sell+'g)',CROPS.embermelon.sell,'harvest_embermelon','sell'],
    ['Sell Slime goo (+15g)',15,'goo','sell'],
  ];
  const who=S.align>=20?'\nMarla beams: “Hero\'s discount, dear!”':S.align<=-20?'\nMarla narrows eyes: “I\'m watching you… prices up.”':'\nMarla: “Seeds in spring, gold in fall, dear.”';
  $('panel-title').textContent='🛒 Marla\'s Seed & Sundry';
  $('panel-body').textContent='Your gold: '+S.gold+'g'+who;
  const c=$('panel-choices');c.innerHTML='';
  rows.forEach(([label,price,kind,mode])=>{
    const b=document.createElement('button');
    const have=S.inv[kind]||0;
    b.textContent=(mode==='buy'?'BUY ':'SELL ')+label+(mode==='sell'?` (x${have})`:'');
    b.onclick=()=>{
      if(mode==='buy'){if(S.gold<price){toast('Not enough gold. Harvest & sell!');return;}S.gold-=price;S.inv[kind]=(S.inv[kind]||0)+1;beep(700,0.08);}
      else{if((S.inv[kind]||0)<=0){toast('None to sell.');return;}S.inv[kind]--;S.gold+=price;beep(900,0.08);}
      save();openShop();updateHUD();
    };
    c.appendChild(b);
  });
  $('panel').classList.remove('hidden');
}
function openShopBuySeed(tool){
  toast(`No ${CROPS[tool].name} seeds — visit Marla's shop (NE 🛒).`);
  openShop();
}
function openSleep(){
  panel('😴 Sleep until morning?','Energy & health restore. Crops grow if watered. New day, new gossip.',
    [{label:'💤 Sleep (advance 1 day)',cls:'good',fn:()=>{closePanel();sleep();}},
     {label:'Not yet',fn:closePanel}]);
}
function sleep(silent){
  // grow crops
  for(const k in S.farm){const f=S.farm[k];if(f.crop&&f.watered){/* grows overnight */} f.watered=false;}
  S.day++;S.minute=7*60;S.energy=100;S.hp=Math.min(100,S.hp+40);
  S.enemies.push({x:rnd(24,30)*TILE,y:rnd(10,19)*TILE,hp:30,t:0,hurt:0});
  if(S.enemies.length>5)S.enemies.shift();
  beep(330,0.2,'sine');toast('☀️ Day '+S.day+' — crops thirst! Water them.');
  save();updateHUD();
  if(!silent)closePanel();
}
function openHeart(){
  const needG=1000,needR=6;
  const canHonest=S.gold>=needG&&S.renown>=needR;
  panel('💎 The Heartstone',
    `An ancient stone, cold and grey.\n\nHonest rite: ${needG}g + ${needR} Renown (you: ${S.gold}g, ${S.renown}★).\nDark rite: steal the UnderShard (pond after 21:00) — instant, but damning.`,
    [{label:canHonest?'👼 Offer gold & renown — HEAL THE VALE (Good ending path)':'👼 Offer… (need '+needG+'g & '+needR+'★)',cls:'good',fn:()=>{if(!canHonest){toast('Not yet: farm, quest, fight slimes for renown.');return;}S.gold-=needG;S.heartDone=true;S.renown+=3;align(20,'You healed the Heartstone!');closePanel();endGame('good');save();}},
     {label:'Leave the stone',fn:closePanel}]);
}
function checkWin(){if(S.renown>=6&&(S.quests.q1>=2)&&(S.quests.q2>=2)&&!S.ended){toast('💎 The Heartstone glows… go to the plaza!');}updateHUD();save();}
function endGame(kind){
  S.ended=true;save();
  $('ending').classList.remove('hidden');
  if(kind==='good'||S.align>=0){
    $('end-title').textContent=S.align<=-20?'👑 DARK SOVEREIGN OF THE VALE':'👼 DAWNBRINGER OF THE VALE';
    $('end-text').textContent=S.align<=-20?
      'You healed the stone — but with stolen gold and fear. Children hush when you pass. Crows follow. The vale blooms… black roses. (Evil-flavored victory — Renown '+S.renown+', Day '+S.day+')':
      'Sunlight breaks. The Heartstone blooms gold. Wren rides your shoulders, the Mayor weeps, Marla gives free pie forever. Songs will name you KIND. (Renown '+S.renown+', Day '+S.day+', Gold '+S.gold+')';
  }
  save();
}
$('btn-again').onclick=()=>{localStorage.removeItem('vale-of-oaths');location.reload();};

// ---------- HUD / hotbar ----------
function updateHUD(){
  $('hud-day').innerHTML='☀️ Day '+S.day+' <span id="hud-time">'+fmtTime()+'</span>';
  $('hud-energy').textContent=Math.max(0,Math.round(S.energy));
  $('hud-hp').textContent=Math.max(0,Math.round(S.hp));
  $('hud-gold').textContent=S.gold;
  $('hud-renown').textContent=S.renown;
  const a=S.align>=20?'👼 Good':S.align<=-20?'😈 Evil':'⚖️ Neutral';
  $('hud-align').innerHTML=a+' ('+S.align+') &nbsp; ★ <span id="hud-renown">'+S.renown+'</span>';
  const hb=$('hotbar');hb.innerHTML='';
  TOOLS.forEach((t,i)=>{
    const d=document.createElement('div');d.className='slot'+(i===S.tool?' active':'');
    let sub=t.name;
    if(CROPS[t.id])sub=`x${S.inv[t.id]||0}`;
    if(t.id==='hoe'||t.id==='water'||t.id==='sword')sub=t.name;
    d.innerHTML=t.icon+'<small>'+sub+'</small>';
    d.onclick=()=>{S.tool=i;beep(600,0.05);updateHUD();};
    hb.appendChild(d);
  });
}
function cycleTool(){S.tool=(S.tool+1)%TOOLS.length;beep(600,0.05);toast(TOOLS[S.tool].icon+' '+TOOLS[S.tool].name);updateHUD();}

// =====================================================================
//  SPRITE ENGINE — 100% original 16x16 farm-sim style art.
//  Tiles are pre-rendered once to offscreen canvases (1 art-px = 2 screen
//  px, so a 16x16 sprite fills a 32x32 tile). Actors are drawn live with
//  chunky 2px art-pixels for the same hand-made feel.
// =====================================================================
function px(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h));}
function makeTile(painter){const c=document.createElement('canvas');c.width=16;c.height=16;const g=c.getContext('2d');painter(g);return c;}
function blot(g,x,y,w,h,c){g.fillStyle=c;g.fillRect(x|0,y|0,w,h);}
function drawTileImg(img,sx,sy){ctx.drawImage(img,Math.round(sx),Math.round(sy),TILE,TILE);}
function drawTileImgCrop(img,cx,cy,cw,ch,sx,sy,sw,sh){ctx.drawImage(img,cx,cy,cw,ch,Math.round(sx),Math.round(sy),sw,sh);}

// genre-style palette (original, tuned for cozy farm-sim feel)
const PAL={
  grass:['#77bd4e','#6fb346','#66a83f'],
  grassD:'#4f8a32', grassL:'#93d863', tuft:'#3f7a2b',
  dirt:'#8a5f36', dirtD:'#6b4423', dirtL:'#a3763f',
  wet:'#5a3a20', wetD:'#422a14', wetL:'#75502c',
  water:'#3d7bd4', waterD:'#2f5fae', waterL:'#6fb3ec', foam:'#d8f0ff',
  sand:'#e3d09b', sandD:'#c2ab72',
  path:'#d9b77c', pathD:'#b28e54', pebble:'#e8d5a4',
  plaza:'#c9bda6', plazaD:'#9d9070', plazaL:'#ded4bd',
  wood:'#8a5a2b', woodD:'#6b4423', woodL:'#a9763f',
  leaf:'#2e8a3e', leafD:'#1f6b2c', leafL:'#54c05e',
  pine:'#2a7a44', pineD:'#1d5a30', pineL:'#43a85c',
  rock:'#9aa0a8', rockD:'#6f757e', rockL:'#c6ccd4', moss:'#5da33c',
  skin:'#f2c89b', skinD:'#d9a06b', hair:'#6b4423',
  roof:'#b0442f', roofD:'#7d2f22', roofL:'#d4694e',
  wall:'#efe0bd', wallD:'#c9b183', cream:'#f7efD8',
};

function paintGrass(g,v){
  const R=lcg(v*7919+13);
  blot(g,0,0,16,16,PAL.grass[v%3]);
  for(let i=0;i<16;i++)blot(g,R()*16,R()*16,1,1,PAL.grassD);
  for(let i=0;i<6;i++)blot(g,R()*16,R()*16,1,1,PAL.grassL);
  // tiny blades
  for(let i=0;i<3;i++){const x=1+R()*14,y=1+R()*14;blot(g,x,y,1,2,PAL.tuft);}
}
function paintFlower(g,v){
  paintGrass(g,v);
  const R=lcg(v*104729+7);
  const cols=['#ff8fb3','#ffffff','#ffd75e','#c99df5'];
  for(let i=0;i<3;i++){
    const x=2+R()*12,y=3+R()*10;
    blot(g,x,y+2,1,3,'#2e7d34'); // stem
    blot(g,x-1,y,3,2,cols[(v+i)%cols.length]); // blossom
    blot(g,x,y,1,1,'#fff8'); // petal light
  }
}
function paintPath(g,v){
  const R=lcg(v*31337+3);
  blot(g,0,0,16,16,PAL.path);
  for(let i=0;i<10;i++)blot(g,R()*16,R()*16,2,1,PAL.pathD);
  for(let i=0;i<5;i++)blot(g,R()*16,R()*16,1,1,PAL.pebble);
}
function paintPlaza(g,v){
  const R=lcg(v*27183+5);
  blot(g,0,0,16,16,PAL.plaza);
  blot(g,0,0,16,1,PAL.plazaD);blot(g,0,15,16,1,PAL.plazaD);
  blot(g,0,0,1,16,PAL.plazaD);blot(g,15,0,1,16,PAL.plazaD);
  blot(g,1,1,6,5,PAL.plazaL);blot(g,9,9,6,5,PAL.plazaL);
  for(let i=0;i<4;i++)blot(g,R()*16,R()*16,1,1,PAL.plazaD);
}
function paintSoil(g,wet){
  const R=lcg(wet?99:7);
  blot(g,0,0,16,16,wet?PAL.wet:PAL.dirt);
  // furrow rows
  for(let y=2;y<16;y+=4)blot(g,0,y,16,2,wet?PAL.wetD:PAL.dirtD);
  blot(g,0,3,16,1,wet?PAL.wetL:PAL.dirtL);
  blot(g,0,7,16,1,wet?PAL.wetL:PAL.dirtL);
  blot(g,0,11,16,1,wet?PAL.wetL:PAL.dirtL);
  blot(g,0,15,16,1,wet?PAL.wetL:PAL.dirtL);
  for(let i=0;i<10;i++)blot(g,R()*16,R()*16,1,1,wet?PAL.wetL:PAL.dirtL);
  if(wet){blot(g,2,5,2,1,'#8fbfe888');blot(g,10,13,3,1,'#8fbfe866');}
}
function paintWater(g,v,frame){
  blot(g,0,0,16,16,PAL.water);
  const R=lcg(v*617+frame*101);
  for(let i=0;i<5;i++)blot(g,R()*16,R()*16,1,1,PAL.waterD);
  // animated wave dashes drift with frame
  for(let i=0;i<4;i++){
    const x=(R()*16+frame*3)%16, y=R()*16;
    blot(g,x,y,3,1,frame?PAL.waterL:PAL.foam);
  }
  blot(g,0,0,16,1,PAL.waterL);
}
function paintSand(g,v){
  const R=lcg(v*999+1);
  blot(g,0,0,16,16,PAL.sand);
  for(let i=0;i<12;i++)blot(g,R()*16,R()*16,1,1,PAL.sandD);
}
function paintBridge(g){
  blot(g,0,0,16,16,PAL.water);
  blot(g,0,2,16,3,PAL.waterD);
  for(let x=0;x<16;x+=3){blot(g,x,4,3,8,PAL.wood);blot(g,x,4,3,1,PAL.woodL);blot(g,x,11,3,1,PAL.woodD);}
  blot(g,0,3,16,1,PAL.woodD);blot(g,0,12,16,1,PAL.woodD);
}

const TILECACHE={};
function tileImg(kind,v,frame){
  const k=kind+'_'+v+'_'+(frame||0);
  if(TILECACHE[k])return TILECACHE[k];
  let img;
  if(kind==='grass')img=makeTile(g=>paintGrass(g,v));
  else if(kind==='flower')img=makeTile(g=>paintFlower(g,v));
  else if(kind==='path')img=makeTile(g=>paintPath(g,v));
  else if(kind==='plaza')img=makeTile(g=>paintPlaza(g,v));
  else if(kind==='soil')img=makeTile(g=>paintSoil(g,false));
  else if(kind==='soilWet')img=makeTile(g=>paintSoil(g,true));
  else if(kind==='water')img=makeTile(g=>paintWater(g,v,frame||0));
  else if(kind==='sand')img=makeTile(g=>paintSand(g,v));
  else if(kind==='bridge')img=makeTile(g=>paintBridge(g));
  TILECACHE[k]=img;return img;
}

// ---------- ground + objects ----------
function isWaterT(tx,ty){
  if(tx<0||ty<0||tx>=MW||ty>=MH)return false;
  const t=S.tiles[ty][tx];return t===2||t===10;
}
function drawGround(t,tx,ty,sx,sy,F){
  const h=hash2(tx,ty);
  const v=Math.floor(h*7.99);
  if(t===2){ // pond water with sandy shore + lilies + glints
    let shore=false;
    if(!isWaterT(tx-1,ty)||!isWaterT(tx+1,ty)||!isWaterT(tx,ty-1)||!isWaterT(tx,ty+1))shore=true;
    if(shore){
      drawTileImg(tileImg('sand',v),sx,sy);
      const fr=Math.floor(F.time*1.5)%2;
      drawTileImgCrop(tileImg('water',v,fr),2,2,12,12,sx+4,sy+4,24,24);
      // foam laps on the land side
      if(!isWaterT(tx,ty+1))px(sx+4,sy+26,24,2,'#d8f0ff88');
      if(!isWaterT(tx,ty-1))px(sx+4,sy+4,24,2,'#d8f0ff88');
    } else {
      drawTileImg(tileImg('water',v,Math.floor(F.time*1.5)%2),sx,sy);
      if(h>0.55){ // lily pads
        px(sx+8,sy+14,10,6,'#2e8a3e');px(sx+20,sy+8,8,5,'#2e8a3e');
        if(h>0.8){px(sx+10,sy+8,4,4,'#ff9dc4');px(sx+11,sy+9,2,2,'#ffd75e');}
      }
    }
    return;
  }
  if(t===10){drawTileImg(tileImg('bridge',v),sx,sy);return;}
  if(t===1){drawTileImg(tileImg('path',v),sx,sy);return;}
  if(t===11){drawTileImg(tileImg('plaza',v),sx,sy);return;}
  // grassy base under everything else
  if(t===7)drawTileImg(tileImg('flower',v),sx,sy);
  else drawTileImg(tileImg('grass',v%3),sx,sy);
  // meadow tufts on plain grass
  if(t===0&&h>0.62){
    const o=Math.floor(h*10)%3;
    px(sx+6+o*4,sy+16,2,6,PAL.tuft);px(sx+9+o*4,sy+14,2,7,PAL.tuft);px(sx+12+o*4,sy+17,2,5,PAL.leaf);
  }
  if(t===5){drawTree(tx,ty,sx,sy,F,h);}
  else if(t===6){drawRock(sx,sy,h);}
  else if(t===8){drawFence(tx,ty,sx,sy);}
  else if(t===3||t===4){drawTileImg(tileImg('path',(v+3)%8),sx,sy);} // packed dirt under buildings
  else if(t===12){drawHeartstone(sx,sy,F);}
}

function drawTree(tx,ty,sx,sy,F,h){
  // soft shadow
  ctx.fillStyle='#00000033';ctx.beginPath();ctx.ellipse(sx+16,sy+29,12,4,0,0,7);ctx.fill();
  px(sx+13,sy+14,6,16,PAL.woodD); // trunk
  px(sx+13,sy+14,2,16,PAL.wood);
  const sway=Math.round(Math.sin(F.time*1.2+h*9)*2);
  if(h<0.55){ // broadleaf oak
    const cx=sx+16+sway;
    px(cx-15,sy-12,30,20,PAL.leafD);
    px(cx-12,sy-16,24,18,PAL.leaf);
    px(cx-9,sy-18,14,8,PAL.leafL);
    px(cx-12,sy-6,5,5,PAL.leafL); // sunlit blobs
    px(cx+6,sy-12,4,4,PAL.leafL);
    px(cx-4,sy-2,8,4,PAL.leafD); // under-shade
    if(h>0.3){px(cx-6,sy-8,3,3,'#ff8fb3');px(cx+5,sy-4,3,3,'#ffd75e');} // blossom flecks
  } else { // pine
    const cx=sx+16;
    px(cx-11+sway,sy+2,22,8,PAL.pineD);
    px(cx-9+sway,sy-6,18,9,PAL.pine);
    px(cx-7+sway,sy-13,14,8,PAL.pine);
    px(cx-4+sway,sy-19,8,7,PAL.pine);
    px(cx-6+sway,sy-11,3,12,PAL.pineL); // lit edge
    px(cx-2+sway,sy-21,3,3,PAL.pineL);
  }
}
function drawRock(sx,sy,h){
  ctx.fillStyle='#0000002e';ctx.beginPath();ctx.ellipse(sx+16,sy+28,11,4,0,0,7);ctx.fill();
  px(sx+6,sy+12,20,16,PAL.rockD);
  px(sx+8,sy+9,16,15,PAL.rock);
  px(sx+10,sy+11,7,5,PAL.rockL); // highlight
  px(sx+8,sy+22,6,4,PAL.rockD);
  if(h>0.4){px(sx+20,sy+20,6,5,PAL.moss);px(sx+9,sy+14,3,2,PAL.moss);} // moss
  if(h<0.3){px(sx+2,sy+24,5,4,PAL.rock);px(sx+25,sy+25,4,3,PAL.rockD);} // pebbles
}
function drawFence(tx,ty,sx,sy){
  const L=S.tiles[ty]&&(S.tiles[ty][tx-1]===8), R=S.tiles[ty]&&(S.tiles[ty][tx+1]===8);
  px(sx,sy+12,TILE,5,PAL.woodD); // rails w/ shade
  px(sx,sy+12,TILE,2,PAL.wood);
  px(sx,sy+22,TILE,5,PAL.woodD);
  px(sx,sy+22,TILE,2,PAL.woodL);
  if(!L||!R||true){ // post every tile, capped
    px(sx+12,sy+8,8,22,PAL.woodD);
    px(sx+13,sy+8,6,20,PAL.wood);
    px(sx+13,sy+8,6,3,PAL.woodL);
    px(sx+12,sy+6,8,4,PAL.woodD); // cap
  }
}
function drawHeartstone(sx,sy,F){
  drawTileImg(tileImg('plaza',3),sx,sy);
  const active=S.heartDone||S.renown>=4;
  const pulse=active?(0.6+0.4*Math.sin(F.time*3)):0;
  if(active){
    ctx.fillStyle=`rgba(255,215,94,${0.25+pulse*0.2})`;
    ctx.beginPath();ctx.ellipse(sx+16,sy+20,20,10,0,0,7);ctx.fill();
  }
  // pedestal
  px(sx+7,sy+20,18,9,'#6f757e');px(sx+7,sy+20,18,3,'#c6ccd4');
  px(sx+10,sy+14,12,7,'#9aa0a8');px(sx+10,sy+14,12,2,'#c6ccd4');
  // crystal
  const cc=active?'#ff7fa5':'#5a5a64', cl=active?'#ffd7e6':'#8d8d96';
  px(sx+12,sy+2,8,14,active?'#7d5a8a':cc);
  px(sx+13,sy+3,3,12,active?'#ff9dc4':cl);
  if(active){px(sx+14,sy+5,2,4,'#fff');px(sx+4+Math.sin(F.time*3)*3,sy,3,3,'#fff8');}
}

// ---------- farm soil + staged crops ----------
function drawFarm(k,f,sx,sy,F){
  drawTileImg(tileImg(f.watered?'soilWet':'soil',0),sx,sy);
  if(!f.crop){
    // seed holes hint
    px(sx+8,sy+10,3,3,PAL.dirtD);px(sx+21,sy+18,3,3,PAL.dirtD);
    return;
  }
  const c=CROPS[f.crop];
  const age=S.day-f.planted+(f.watered?0.4:0);
  const st=clamp(age/c.days,0,1);
  const stage=st>=1?3:st>0.55?2:st>0.25?1:0;
  const cx=sx+16, gy=sy+27;
  const sway=Math.round(Math.sin(F.time*2+cx)*1);
  if(stage===0){ // sprout
    px(cx-3+sway,gy-8,2,8,c.leafD);px(cx+1+sway,gy-8,2,8,c.leafD);
    px(cx-6+sway,gy-12,5,4,c.leaf);px(cx+1+sway,gy-13,5,4,c.leaf);
  } else if(stage===1){ // leafy sprout
    px(cx-1,gy-16,3,16,c.leafD);
    px(cx-9+sway,gy-14,8,5,c.leaf);px(cx+1+sway,gy-15,8,5,c.leaf);
    px(cx-7+sway,gy-19,6,4,c.leaf);px(cx+1+sway,gy-20,6,4,c.leafD);
  } else if(stage===2){ // bush + buds
    px(cx-2,gy-18,4,18,c.leafD);
    px(cx-11+sway,gy-16,22,12,c.leaf);
    px(cx-9+sway,gy-18,18,5,c.leafL);
    px(cx-8+sway,gy-22,5,5,c.color);px(cx+3+sway,gy-21,5,5,c.color); // buds
    px(cx-7+sway,gy-21,2,2,'#ffffffaa');
  } else { // mature produce
    px(cx-2,gy-16,4,16,c.leafD);
    px(cx-12+sway,gy-14,24,10,c.leaf);
    px(cx-10+sway,gy-16,20,4,c.leafL);
    if(f.crop==='sunroot'){
      px(cx-7,gy-16,14,13,c.color);px(cx-7,gy-16,14,3,c.dark);
      px(cx-5,gy-13,4,5,'#fff6');px(cx-7,gy-6,14,2,c.dark);
      px(cx-4,gy-20,3,5,c.leaf);px(cx+1,gy-21,3,6,c.leaf);
    } else if(f.crop==='moonberry'){
      const b=[[-9,-14],[-2,-16],[4,-13],[-6,-9],[2,-8]];
      for(const [ox,oy] of b){px(cx+ox+sway,gy+oy,7,7,c.dark);px(cx+ox+sway,gy+oy,7,5,c.color);px(cx+ox+1+sway,gy+oy+1,2,2,'#fff');}
    } else { // embermelon — big ribbed melon
      px(cx-10+sway,gy-22,20,18,c.dark);
      px(cx-9+sway,gy-22,18,18,c.color);
      px(cx-5+sway,gy-22,3,18,c.dark);px(cx+1+sway,gy-22,3,18,c.dark);
      px(cx-7+sway,gy-20,4,4,'#fff8');
      px(cx+6+sway,gy-24,6,3,c.leaf); // curly vine
    }
    // ripe sparkle blink
    if(Math.floor(F.time*2+cx)%3===0){px(cx+10,gy-26,2,6,'#fff');px(cx+8,gy-24,6,2,'#fff');}
  }
}

// ---------- actors: chunky 2px art-pixels ----------
// P draws one art-pixel (2x2 screen px) at art coords relative to (ox,oy)
function P(ox,oy,ax,ay,w,h,c){px(ox+ax*2,oy+ay*2,w*2,h*2,c);}
function shadow(sx,sy,w){ctx.fillStyle='#00000044';ctx.beginPath();ctx.ellipse(sx+16,sy+30,w||10,4,0,0,7);ctx.fill();}

function drawPlayer(sx,sy){
  const bob=S.moving?Math.round(Math.sin(S.anim*0.5)):0;
  const step=S.moving?(Math.floor(S.anim*1.4)%2):0;
  const ox=sx, oy=sy+bob; // 16x24 art box
  shadow(sx,sy,10);
  let shirt='#4f8fde', shirtD='#3a6cb0';
  if(S.align>=20){shirt='#f2e6b8';shirtD='#c9b183';}
  if(S.align<=-20){shirt='#7a2a2a';shirtD='#4f1a1a';}
  const flip=S.face<0;
  ctx.save();
  if(flip){ctx.translate(sx+TILE,0);ctx.scale(-1,1);}
  const X=flip?sx:sx; // draw in flipped space using sx origin
  const o=X;
  // legs (2-frame)
  if(step===0){P(o,oy,5,19,2,3,'#3a5a8c');P(o,oy,9,19,2,3,'#334e7d');}
  else{P(o,oy,5,19,2,2,'#3a5a8c');P(o,oy,9,20,2,2,'#334e7d');}
  P(o,oy,5,22,2,1,'#4a2f1a');P(o,oy,9,step?22:22,2,1,'#4a2f1a'); // boots
  // torso: shirt + denim overalls
  P(o,oy,4,12,8,7,shirt);
  P(o,oy,4,12,8,1,shirtD);
  P(o,oy,5,13,2,6,'#3a5a8c');P(o,oy,9,13,2,6,'#3a5a8c'); // overall legs
  P(o,oy,5,12,2,3,'#3a5a8c');P(o,oy,9,12,2,3,'#3a5a8c'); // straps
  P(o,oy,5,13,1,1,'#ffd75e');P(o,oy,10,13,1,1,'#ffd75e'); // buttons
  // arms
  const sw=S.moving?(step?1:-1):0;
  P(o,oy,2,12+sw,2,5,shirt);P(o,oy,12,12-sw,2,5,shirt);
  P(o,oy,2,16+sw,2,2,PAL.skin);P(o,oy,12,16-sw,2,2,PAL.skin);
  // head
  P(o,oy,4,5,8,7,PAL.skin);
  P(o,oy,4,9,8,1,PAL.skinD);
  P(o,oy,3,6,1,4,PAL.hair);P(o,oy,12,6,1,4,PAL.hair); // side hair
  P(o,oy,6,8,1,1,'#222');P(o,oy,9,8,1,1,'#222'); // eyes
  // straw hat — the farm-sim signature
  P(o,oy,1,3,14,2,'#d9a94f');P(o,oy,1,4,14,1,'#b08234'); // brim
  P(o,oy,4,0,8,3,'#e8c05e');P(o,oy,4,2,8,1,'#b08234'); // dome
  P(o,oy,4,1,8,1,'#b0442f'); // hat band
  // held tool
  const t=TOOLS[S.tool].id;
  if(t==='hoe'){P(o,oy,13,10,1,8,PAL.wood);P(o,oy,12,9,3,2,'#9aa0a8');}
  else if(t==='sword'){P(o,oy,13,6,1,8,'#cfd4dc');P(o,oy,13,6,1,2,'#fff');P(o,oy,12,14,3,1,PAL.wood);}
  else if(t==='water'){P(o,oy,12,13,4,4,'#4f8fde');P(o,oy,13,11,2,2,'#9fd4ff');P(o,oy,15,12,1,2,'#9fd4ff');}
  else if(CROPS[t]){P(o,oy,12,14,4,3,'#c9a468');P(o,oy,13,12,2,2,'#8a5a2b');} // seed pouch
  ctx.restore();
  // alignment aura (unflipped)
  if(S.align>=20){ctx.strokeStyle='#ffd75e';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(sx+16,sy-1+bob,9,4,0,0,7);ctx.stroke();}
  if(S.align<=-20){px(sx+7,sy-3+bob,5,7,'#c22');px(sx+20,sy-3+bob,5,7,'#c22');px(sx+8,sy-2+bob,3,3,'#ff8d8d');}
}

function drawNPC(n,sx,sy){
  const ox=sx, oy=sy;
  shadow(sx,sy,9);
  const blink=(Math.floor(performance.now()/3000+n.x)%7===0);
  if(n.id==='mayor'){
    P(ox,oy,5,18,2,4,'#222');P(ox,oy,9,18,2,4,'#222'); // pants
    P(ox,oy,5,22,2,1,'#000');P(ox,oy,9,22,2,1,'#000');
    P(ox,oy,4,11,8,8,'#5a3a6b');P(ox,oy,7,11,2,8,'#f2e6b8'); // coat + cravat
    P(ox,oy,4,11,8,1,'#3a2547');
    P(ox,oy,2,11,2,6,'#5a3a6b');P(ox,oy,12,11,2,6,'#5a3a6b'); // arms
    P(ox,oy,4,4,8,7,PAL.skin);
    P(ox,oy,5,9,6,2,'#cfcfcf'); // mustache
    if(!blink){P(ox,oy,6,7,1,1,'#222');P(ox,oy,9,7,1,1,'#222');}
    else{P(ox,oy,6,7,1,1,'#222');P(ox,oy,9,7,1,1,'#222');}
    P(ox,oy,4,-1,8,5,'#1a1a1a'); // top hat
    P(ox,oy,4,3,8,1,'#1a1a1a');
    P(ox,oy,1,3,14,1,'#1a1a1a'); // brim
    P(ox,oy,4,2,8,1,'#ffd75e'); // gold band
  } else if(n.id==='wren'){ // kid, shorter
    const oy2=oy+8;
    P(ox,oy2,5,15,2,3,'#3a5a8c');P(ox,oy2,9,15,2,3,'#3a5a8c');
    P(ox,oy2,5,18,2,1,'#4a2f1a');P(ox,oy2,9,18,2,1,'#4a2f1a');
    P(ox,oy2,4,10,8,6,'#ffd75e');P(ox,oy2,4,10,8,1,'#d9a012'); // yellow shirt
    P(ox,oy2,2,10,2,4,'#ffd75e');P(ox,oy2,12,10,2,4,'#ffd75e');
    P(ox,oy2,4,3,8,7,PAL.skin);
    P(ox,oy2,5,6,1,1,'#c9803c');P(ox,oy2,10,6,1,1,'#c9803c'); // freckles
    if(!blink){P(ox,oy2,6,6,1,1,'#222');P(ox,oy2,9,6,1,1,'#222');}
    P(ox,oy2,7,8,2,1,'#a05a2a'); // smile
    P(ox,oy2,3,0,10,3,'#c94f7c');P(ox,oy2,11,1,4,1,'#c94f7c'); // cap (backwards)
    P(ox,oy2,3,2,10,1,'#a03a5e');
  } else { // sage
    P(ox,oy,4,11,8,12,'#2e3a6b');P(ox,oy,4,11,8,1,'#1d2547'); // robe
    P(ox,oy,6,13,4,8,'#3f4f8f'); // robe fold light
    P(ox,oy,2,11,2,5,'#2e3a6b');P(ox,oy,12,13,2,4,'#2e3a6b');
    P(ox,oy,4,4,8,7,'#e8b98a');
    P(ox,oy,5,9,6,5,'#e8e8e8');P(ox,oy,6,12,4,3,'#cfcfcf'); // long beard
    if(!blink){P(ox,oy,6,7,1,1,'#222');P(ox,oy,9,7,1,1,'#222');}
    P(ox,oy,2,0,12,4,'#4a3a7a');P(ox,oy,2,3,12,1,'#ffd75e'); // wide-brim hat
    P(ox,oy,5,-2,6,3,'#4a3a7a');
    // staff with glowing orb
    P(ox,oy,13,6,1,14,'#8a5a2b');
    P(ox,oy,12,4,3,3,'#9fd4ff');P(ox,oy,13,5,1,1,'#fff');
  }
  // nameplate + quest mark
  ctx.fillStyle='#000a';ctx.fillRect(sx-8,sy-22,48,14);
  ctx.fillStyle='#fff';ctx.font='10px system-ui';ctx.textAlign='center';
  ctx.fillText(n.name.split(' ')[0],sx+16,sy-12);
  const hasQ=(n.id==='mayor'&&S.quests.q1===1&&(S.inv.harvest_sunroot||0)>=3)||(n.id==='wren'&&S.quests.q2===1&&S.inv.toy)||(n.id==='mayor'&&S.quests.q1===0)||(n.id==='wren'&&S.quests.q2===0);
  if(hasQ){ctx.fillStyle='#ffd75e';ctx.font='bold 16px system-ui';ctx.fillText('!',sx+16,sy-24);}
}

function drawSlime(e,sx,sy,idx){
  const squash=Math.sin(e.t*6+idx)*2;
  const w=24+squash, h=18-squash;
  const hurt=(e.hurt||0)>0;
  const blue=idx%3===2;
  const body=hurt?'#ff9d9d':blue?'#6fb3ec':'#54e06a';
  const dark=hurt?'#c96a6a':blue?'#3d7bd4':'#2e9d4a';
  const light=hurt?'#ffd0d0':blue?'#bfe0ff':'#a8f0b0';
  ctx.fillStyle='#00000033';ctx.beginPath();ctx.ellipse(sx+16,sy+28,w/2,4,0,0,7);ctx.fill();
  // hp pips
  if(e.hp<50){px(sx+8,sy-2,16,3,'#000a');px(sx+9,sy-1,14*(Math.max(e.hp,0)/50),1,'#ff5a5a');}
  px(sx+16-w/2,sy+28-h,w,h-4,dark); // base
  px(sx+16-w/2+2,sy+28-h,w-4,h-6,body); // gel
  px(sx+16-w/2+3,sy+28-h+2,5,4,light); // shine
  px(sx+16-w/2+2,sy+28-4,w-4,2,dark); // base shade
  const ey=sy+28-h+7;
  px(sx+10,ey,3,5,'#123a1d');px(sx+19,ey,3,5,'#123a1d'); // eyes
  px(sx+10,ey,1,2,'#fff');px(sx+19,ey,1,2,'#fff');
}

// ---------- buildings (drawn whole, not per-tile) ----------
const HOUSE={x:4*TILE,bottom:16*TILE,w:4*TILE};   // tiles x4-7, y13-15
const SHOP={x:21*TILE,bottom:5*TILE,w:3*TILE};     // tiles x21-23, y3-4
function drawHouse(F,night){
  const bx=HOUSE.x, by=HOUSE.bottom;
  ctx.fillStyle='#00000030';ctx.beginPath();ctx.ellipse(bx+64,by+4,70,10,0,0,7);ctx.fill();
  // stone foundation
  px(bx+6,by-26,116,24,'#8d8d96');px(bx+6,by-26,116,5,'#c6ccd4');
  px(bx+6,by-8,116,4,'#6f757e');
  // cream walls with timber frame
  px(bx+10,by-78,108,54,PAL.wall);
  px(bx+10,by-78,108,4,PAL.wallD);
  px(bx+10,by-30,108,4,PAL.wallD);
  for(const fx of [10,40,70,110])px(bx+fx,by-78,5,52,'#8a5a2b');
  // door
  px(bx+56,by-58,24,34,'#5a3a22');px(bx+58,by-56,20,32,'#7d5527');
  px(bx+74,by-40,4,4,'#ffd75e');
  px(bx+56,by-58,24,4,'#3a2a18');
  // windows (glow at night)
  for(const wx of [20,92]){
    px(bx+wx,by-70,22,20,'#3a2a18');
    px(bx+wx+2,by-68,18,16,night?'#ffdf7e':'#9fd4ff');
    px(bx+wx+2,by-68,18,4,night?'#fff3c4':'#d8f0ff');
    px(bx+wx+10,by-68,2,16,'#3a2a18');px(bx+wx+2,by-60,18,2,'#3a2a18');
  }
  if(night){ctx.fillStyle='rgba(255,220,120,.18)';ctx.beginPath();ctx.ellipse(bx+31,by-60,26,22,0,0,7);ctx.fill();ctx.beginPath();ctx.ellipse(bx+103,by-60,26,22,0,0,7);ctx.fill();}
  // red shingle roof with overhang
  px(bx-8,by-108,144,34,PAL.roofD);
  px(bx-4,by-106,136,28,PAL.roof);
  for(let i=0;i<6;i++)px(bx+2+i*23,by-104,12,3,PAL.roofL);
  for(let i=0;i<6;i++)px(bx+8+i*23,by-96,12,3,PAL.roofD);
  px(bx-8,by-82,144,6,'#5a2018'); // eave shade
  px(bx+44,by-118,40,12,PAL.roofD); // ridge
  px(bx+48,by-120,32,6,PAL.roof);
  // chimney + smoke
  px(bx+96,by-136,14,32,'#8d8d96');px(bx+96,by-136,14,4,'#6f757e');
  for(let i=0;i<3;i++){
    const ph=(F.time*0.5+i/3)%1;
    const sw2=Math.sin((ph*4+i)*2)*6;
    ctx.fillStyle=`rgba(220,220,220,${0.5*(1-ph)})`;
    ctx.fillRect(bx+100+sw2,by-140-ph*36,8,8);
  }
  // flower boxes
  for(const wx of [20,92]){px(bx+wx,by-50,22,6,'#6b4423');px(bx+wx+2,by-56,4,6,'#ff8fb3');px(bx+wx+9,by-57,4,7,'#ffd75e');px(bx+wx+16,by-56,4,6,'#fff');}
}
function drawShop(F,night){
  const bx=SHOP.x, by=SHOP.bottom;
  ctx.fillStyle='#00000030';ctx.beginPath();ctx.ellipse(bx+48,by+4,54,8,0,0,7);ctx.fill();
  // wooden walls
  px(bx+4,by-52,88,50,'#4f8f7b');px(bx+4,by-52,88,5,'#63a88f');
  for(let i=0;i<4;i++)px(bx+4,by-44+i*12,88,2,'#3a6b5a');
  // striped awning
  for(let i=0;i<6;i++){px(bx-4+i*18,by-72,18,20,i%2?'#f2e6b8':'#2e8a5e');}
  px(bx-4,by-72,108,4,'#1d5a30');
  px(bx-4,by-54,108,4,'#00000033');
  // sign
  px(bx+24,by-92,48,16,'#8a5a2b');px(bx+26,by-90,44,12,'#efe0bd');
  ctx.fillStyle='#4a2f1a';ctx.font='bold 9px system-ui';ctx.textAlign='center';
  ctx.fillText('SEEDS',bx+48,by-80);
  // door + goods window
  px(bx+12,by-34,20,32,'#3a2a18');px(bx+14,by-32,16,30,'#6b4423');
  px(bx+60,by-46,26,24,'#3a2a18');
  px(bx+62,by-44,22,20,night?'#ffdf7e':'#9fd4ff');
  px(bx+62,by-44,22,5,night?'#fff3c4':'#d8f0ff');
  px(bx+64,by-34,5,6,'#ffcf3f');px(bx+72,by-32,6,7,'#9d8bff'); // goods on shelf
  // crates + barrel outside
  px(bx-16,by-16,16,14,'#8a5a2b');px(bx-16,by-16,16,3,'#a9763f');
  px(bx-14,by-30,12,14,'#8a5a2b');px(bx-12,by-28,4,4,'#ffcf3f'); // seed crate
  px(bx+96,by-20,16,18,'#6b4423');px(bx+96,by-14,16,2,'#8a5a2b'); // barrel
  if(night){ctx.fillStyle='rgba(255,220,120,.2)';ctx.beginPath();ctx.ellipse(bx+73,by-34,22,18,0,0,7);ctx.fill();}
}
function drawToy(sx,sy,F){
  const hop=Math.abs(Math.sin(F.time*2))*2;
  ctx.fillStyle='#00000033';ctx.beginPath();ctx.ellipse(sx+16,sy+28,9,3,0,0,7);ctx.fill();
  px(sx+8,sy+14-hop,16,12,'#c9803c'); // fox body
  px(sx+8,sy+10-hop,10,8,'#e8a856'); // head
  px(sx+8,sy+8-hop,4,4,'#e8a856');px(sx+14,sy+8-hop,4,4,'#e8a856'); // ears
  px(sx+10,sy+12-hop,2,2,'#222');px(sx+15,sy+12-hop,2,2,'#222');
  px(sx+22,sy+18-hop,4,6,'#e8a856'); // tail
}

// ---------- ambient critters ----------
function drawAmbient(F,night){
  if(!night){
    for(let i=0;i<4;i++){ // butterflies
      const bx=(hash2(i,7)*W+F.time*14*(i%2?1:-1)+W*2)%W;
      const by=hash2(i,11)*H+Math.sin(F.time*3+i*2)*10;
      const sx=bx-cam.x, sy=by-cam.y;
      if(sx<-10||sy<-10||sx>960+10||sy>640+10)continue;
      const flap=Math.sin(F.time*20+i)>0;
      const c=['#ff8fb3','#ffd75e','#c99df5','#fff'][i];
      px(sx,sy,3,4,c);if(flap){px(sx-3,sy+1,3,3,c);px(sx+3,sy+1,3,3,c);}
    }
  } else {
    for(let i=0;i<10;i++){ // fireflies
      const bx=(hash2(i,21)*W+Math.sin(F.time*0.7+i*2.4)*40+W)%W;
      const by=(hash2(i,33)*H+Math.cos(F.time*0.5+i*1.7)*30+H)%H;
      const sx=bx-cam.x, sy=by-cam.y;
      if(sx<0||sy<0||sx>960||sy>640)continue;
      const tw=0.4+0.6*Math.abs(Math.sin(F.time*2+i));
      ctx.fillStyle=`rgba(255,240,150,${tw})`;
      ctx.fillRect(sx,sy,3,3);
    }
  }
}

// ---------- lighting ----------
function lightLevel(h){ // returns {color, alpha, night}
  if(h>=8&&h<16.5)return{alpha:0,night:false};
  if(h>=16.5&&h<19)return{color:'255,140,40',alpha:0.13,night:false}; // golden hour
  if(h>=6&&h<8)return{color:'255,180,120',alpha:0.07,night:false};
  if(h>=19&&h<21)return{color:'40,30,90',alpha:0.22,night:true};
  return{color:'8,10,60',alpha:0.34,night:h>=21||h<5}; // deep night (5-6 eases via 0.25)
}

// ---------- main loop ----------
let last=0, frameT=0;
function loop(ts){
  requestAnimationFrame(loop);
  const dt=Math.min(0.05,(ts-last)/1000||0.016);last=ts;
  if(!S)return;
  frameT=ts/1000;
  if(!$('panel').classList.contains('hidden')){render();return;} // pause while dialog
  update(dt);
  render();
}
function update(dt){
  S.anim+=dt*10;
  // movement
  let dx=0,dy=0;
  if(keys['w']||keys['arrowup'])dy-=1;
  if(keys['s']||keys['arrowdown'])dy+=1;
  if(keys['a']||keys['arrowleft'])dx-=1;
  if(keys['d']||keys['arrowright'])dx+=1;
  dx+=joy.x;dy+=joy.y;
  if(tapMove){dx+=tapMove.x*0.8;dy+=tapMove.y*0.8;tapMove.t--;if(tapMove.t<=0)tapMove=null;}
  const len=Math.hypot(dx,dy);
  S.moving=len>0.15;
  if(S.moving){
    dx/=Math.max(1,len);dy/=Math.max(1,len);
    if(Math.abs(dx)>0.2)S.face=dx>0?1:-1;
    const sp=150*dt;
    const nx=S.px+dx*sp, ny=S.py+dy*sp;
    if(walkable(nx+TILE/2,S.py+TILE/2))S.px=clamp(nx,0,W-TILE);
    if(walkable(S.px+TILE/2,ny+TILE/2))S.py=clamp(ny,0,H-TILE);
    S.energy=Math.max(0,S.energy-dt*0.15);
  }
  // enemies wander + chase
  for(const e of S.enemies){
    e.t+=dt;
    if(e.hurt>0)e.hurt-=dt;
    const d=Math.hypot(e.x-S.px,e.y-S.py);
    if(d<160){e.x+=(S.px-e.x)/d*40*dt;e.y+=(S.py-e.y)/d*40*dt;
      if(d<30){S.hp-=12*dt;if(S.hp<=0){S.hp=100;S.gold=Math.max(0,S.gold-30);S.px=10*TILE;S.py=12*TILE;toast('💀 Knocked out! Woke at home, -30g doctor fee.');align(0);} }
    } else {e.x+=Math.sin(e.t)*20*dt;e.y+=Math.cos(e.t*0.7)*20*dt;}
  }
  // time passes
  S.minute+=dt*2.2; // ~7min day
  if(S.minute>=24*60)sleep(true);
  // dark-rite steal
  // (checked on action near pond at night)
  // camera follows in render()
  updateHUDFast();
}
let hudT=0;
function updateHUDFast(){const n=performance.now();if(n-hudT>500){hudT=n;$('hud-time').textContent=fmtTime();$('hud-energy').textContent=Math.round(S.energy);$('hud-hp').textContent=Math.round(S.hp);}}
function render(){
  const F={time:frameT};
  // camera in world px, viewport is canvas 960x640 showing part of world
  const vw=960,vh=640;
  cam.x=clamp(S.px+TILE/2-vw/2,0,W-vw);
  cam.y=clamp(S.py+TILE/2-vh/2,0,H-vh);
  ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  const x0=Math.floor(cam.x/TILE),y0=Math.floor(cam.y/TILE),x1=Math.min(MW-1,x0+vw/TILE+1),y1=Math.min(MH-1,y0+vh/TILE+1);
  // 1) ground + flora + small objects
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    drawGround(S.tiles[y][x],x,y,x*TILE-cam.x,y*TILE-cam.y,F);
  }
  // 2) farm plots
  for(const k in S.farm){const [tx,ty]=k.split(',').map(Number);if(tx<x0-1||tx>x1+1||ty<y0-1||ty>y1+1)continue;drawFarm(k,S.farm[k],tx*TILE-cam.x,ty*TILE-cam.y,F);}
  // 3) buildings (whole, after ground)
  const h=S.minute/60, L=lightLevel(h);
  drawHouse(F,L.night||h>=19||h<6);
  drawShop(F,L.night||h>=19||h<6);
  // 4) ground item: toy
  if(!S.toyTaken)drawToy(S.toyX-cam.x,S.toyY-cam.y,F);
  // 5) y-sorted actors
  const actors=[];
  for(const n of S.npcs)actors.push({y:n.y+30,f:()=>drawNPC(n,n.x-cam.x,n.y-cam.y)});
  S.enemies.forEach((e,i)=>actors.push({y:e.y+28,f:()=>drawSlime(e,e.x-cam.x,e.y-cam.y,i)}));
  actors.push({y:S.py+30,f:()=>drawPlayer(S.px-cam.x,S.py-cam.y)});
  actors.sort((a,b)=>a.y-b.y).forEach(a=>a.f());
  // 6) critters
  drawAmbient(F,L.night);
  // 7) light / atmosphere
  if(L.alpha>0){ctx.fillStyle=`rgba(${L.color},${L.alpha})`;ctx.fillRect(0,0,canvas.width,canvas.height);}
  // pond midnight shard
  if(S.quests.q3===1&&!S.heartDone){
    const nearPond=Math.hypot(S.px-4*TILE,S.py-5*TILE)<120;
    if(nearPond&&h>=21){
      ctx.fillStyle='#fff';ctx.font='bold 14px system-ui';ctx.textAlign='center';
      ctx.fillText('🌙 The water glints… press ACT to steal the UnderShard (EVIL)',canvas.width/2,40);
      // check steal trigger each frame? do via action key polling is complex; allow auto-prompt:
      if(!window._shardPrompt){window._shardPrompt=true;
        panel('🌙 The UnderShard','Black glass pulses under the pond. Steal it? Instant Heartstone power — at a price.',
        [{label:'😈 STEAL it (+power, -soul)',cls:'evil',fn:()=>{S.heartDone=true;align(-30,'You stole the UnderShard.');S.renown+=1;closePanel();endGame('evil');save();}},
         {label:'👼 Leave it',cls:'good',fn:()=>{align(3,'You resisted temptation.');closePanel();window._shardPrompt=false;}}]);
      }
    } else window._shardPrompt=false;
  }
  // controls hint desktop
  ctx.fillStyle='rgba(0,0,0,.45)';ctx.fillRect(8,canvas.height-30,330,22);
  ctx.fillStyle='#fff';ctx.font='12px system-ui';ctx.textAlign='left';
  ctx.fillText('WASD move • E act • '+TOOLS[S.tool].icon+' '+TOOLS[S.tool].name+' (🔄 to change)',14,canvas.height-14);
}

// ---------- boot ----------
window.__vale={get state(){return S;}}; // tiny debug hook (drive camera/state in tests)
$('btn-start').onclick=()=>{S=newGame();save();$('title-screen').classList.add('hidden');updateHUD();beep(660,0.15);toast('🌱 Hoe soil near home, plant seeds, water daily!');};
$('btn-continue').onclick=()=>{const s=load();if(s){S=s;$('title-screen').classList.add('hidden');updateHUD();}};
(function init(){
  const s=load();
  if(s&&s.day){$('btn-continue').classList.remove('hidden');$('save-day').textContent=s.day;}
  S=s&&s.day?s:newGame();
  // keep title screen visible for fresh players; if save exists they can continue
  updateHUD();
  requestAnimationFrame(loop);
  // prevent page scroll on touch
  document.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
  setInterval(()=>{if(S&&$('title-screen').classList.contains('hidden'))save();},5000);
})();
})();

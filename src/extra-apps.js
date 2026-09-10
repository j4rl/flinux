import {esc, icon, WALLPAPERS, DESKTOPS, download} from './ui.js';

// A deliberately small, escaped Markdown renderer; documents never execute HTML.
function markdown(text) {
  let inCode=false;
  const inline=line=>esc(line).split(/(`[^`]+`)/g).map((part,index)=>index%2
    ? `<code>${part.slice(1,-1)}</code>`
    : part.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>')).join('');
  return String(text).split('\n').map(line=>{
    if(line.startsWith('```')){inCode=!inCode;return inCode?'<pre><code>':'</code></pre>';}
    if(inCode)return esc(line)+'\n';
    const heading=line.match(/^(#{1,6}) (.*)$/);if(heading)return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    if(/^[-*] /.test(line))return `<div class="markdown-list-item">• ${inline(line.slice(2))}</div>`;
    if(line.startsWith('> '))return `<blockquote>${inline(line.slice(2))}</blockquote>`;
    if(/^---+$/.test(line))return '<hr>';
    return line?`<p>${inline(line)}</p>`:'<br>';
  }).join('')+(inCode?'</code></pre>':'');
}

export function createExtraApps({system, PACKAGE_REGISTRY, toast, applySettings}) {
  function renderMarkdown(root, options={}) {
    let path=options.path||`${system.state.user.home}/Documents/idéer.md`;
    root.innerHTML=`<div class="markdown-app"><div class="toolbar"><button class="primary" data-save>Spara</button><div class="pathbar">${esc(path)}</div><span class="muted">Markdown</span></div><div class="markdown-split"><textarea aria-label="Markdown-källtext" spellcheck="false"></textarea><article class="markdown-preview" aria-label="Förhandsvisning"></article></div><div class="editor-status">Rubriker · fetstil · kursiv · listor · citat · kodblock</div></div>`;
    const area=root.querySelector('textarea'),preview=root.querySelector('article');area.value=system.getNode(path)?.content??'# En glad liten idé\n\nVad vill du bygga idag?\n\n- Utforska terminalen\n- Prova **i3**\n- Gör flinux till ditt\n\n> Allt börjar med en idé.\n';
    const update=()=>preview.innerHTML=markdown(area.value);area.oninput=update;
    const save=()=>{try{system.writeFile(path,area.value);toast(system.storageError||'Markdown-filen är sparad');}catch(e){toast(e.message);}};root.querySelector('[data-save]').onclick=save;area.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();}};update();
  }

  function renderImages(root, options={}) {
    let current=WALLPAPERS.find(w=>w.id===options.wallpaper)||WALLPAPERS[0];
    let uploaded=null;
    const virtual=options.path?system.getNode(options.path)?.content:null;
    if(virtual&&/^data:image\/(png|jpeg|webp);base64,/.test(virtual))uploaded=virtual;
    root.innerHTML=`<div class="image-app"><div class="toolbar"><strong>Bildvisare</strong><span class="pathbar" data-image-name></span><button data-open-image>Öppna bild…</button><button data-set-wallpaper>Använd som bakgrund</button><input type="file" accept="image/png,image/jpeg,image/webp" data-image-file hidden></div><div class="image-stage"><img alt=""></div><div class="image-thumbnails">${WALLPAPERS.map(w=>`<button data-image="${w.id}" title="${w.name}"><img src="assets/wallpapers/${w.id}.svg" alt="${w.name}"></button>`).join('')}</div></div>`;
    const draw=()=>{const image=root.querySelector('.image-stage img');image.src=uploaded||`assets/wallpapers/${current.id}.svg`;image.alt=uploaded?'Din bild':current.name;root.querySelector('[data-image-name]').textContent=uploaded?(options.path?.split('/').pop()||'Din bild'):current.name;root.querySelector('[data-set-wallpaper]').disabled=Boolean(uploaded);root.querySelectorAll('[data-image]').forEach(b=>b.classList.toggle('selected',!uploaded&&b.dataset.image===current.id));};
    root.querySelectorAll('[data-image]').forEach(b=>b.onclick=()=>{if(uploaded?.startsWith('blob:'))URL.revokeObjectURL(uploaded);uploaded=null;current=WALLPAPERS.find(w=>w.id===b.dataset.image);draw();});
    root.querySelector('[data-set-wallpaper]').onclick=()=>{system.state.settings.wallpaper=current.id;system.save();applySettings();toast(`${current.name} pryder nu skrivbordet`);};
    root.querySelector('[data-open-image]').onclick=()=>root.querySelector('[data-image-file]').click();
    root.querySelector('[data-image-file]').onchange=e=>{const file=e.target.files[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('Välj en PNG-, JPEG- eller WebP-bild.');return;}if(uploaded?.startsWith('blob:'))URL.revokeObjectURL(uploaded);uploaded=URL.createObjectURL(file);draw();root.querySelector('[data-image-name]').textContent=file.name;};draw();return()=>{if(uploaded?.startsWith('blob:'))URL.revokeObjectURL(uploaded);};
  }

  function renderClock(root) {
    root.innerHTML=`<div class="clock-app"><span class="section-eyebrow">EN SAK I TAGET</span><div class="big-clock"></div><p data-date></p><div class="clock-tabs"><button class="button active" data-clock-mode="timer">Timer</button><button class="button" data-clock-mode="stopwatch">Stoppur</button></div><div class="timer-setup"><label>Minuter <input type="number" min="1" max="180" value="25" aria-label="Timer i minuter"></label></div><output class="timer-output">25:00</output><div class="timer-actions"><button class="button primary" data-start>Starta</button><button class="button" data-reset>Nollställ</button></div><small class="muted">Ta en paus. Även glada linux behöver vila.</small></div>`;
    let mode='timer',running=false,elapsed=0,start=0;const minutes=root.querySelector('input');
    const duration=()=>Math.max(1,Math.min(180,Number(minutes.value)||25))*60000;
    const reset=()=>{running=false;elapsed=0;root.querySelector('[data-start]').textContent='Starta';minutes.disabled=false;update();};
    const update=()=>{const now=new Date();root.querySelector('.big-clock').textContent=now.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'});root.querySelector('[data-date]').textContent=now.toLocaleDateString('sv-SE',{weekday:'long',day:'numeric',month:'long'});const passed=elapsed+(running?Date.now()-start:0),ms=mode==='timer'?Math.max(0,duration()-passed):passed,s=Math.floor(ms/1000);root.querySelector('.timer-output').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;if(mode==='timer'&&running&&ms<=0){elapsed=duration();running=false;root.querySelector('[data-start]').textContent='Starta igen';minutes.disabled=false;toast('Timern är klar. Dags för en glad liten paus!');}};
    root.querySelectorAll('[data-clock-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.clockMode;root.querySelectorAll('[data-clock-mode]').forEach(x=>x.classList.toggle('active',x===b));root.querySelector('.timer-setup').hidden=mode!=='timer';reset();});
    root.querySelector('[data-start]').onclick=()=>{if(running){elapsed+=Date.now()-start;running=false;}else{if(mode==='timer'&&elapsed>=duration())elapsed=0;start=Date.now();running=true;}minutes.disabled=running;root.querySelector('[data-start]').textContent=running?'Pausa':'Fortsätt';update();};root.querySelector('[data-reset]').onclick=reset;minutes.oninput=reset;const timer=setInterval(update,250);update();return()=>clearInterval(timer);
  }

  function renderSysinfo(root) {
    root.innerHTML=`<div class="sysinfo"><img src="assets/mark.svg" alt="flinux" width="76"><h1>flinux <span>1.0</span></h1><p>Det glada linuxet</p><div class="sysinfo-grid" data-system-info></div><h3 class="settings-label">Tjänster</h3><div data-services></div><div class="about-note"><strong>Fake Linux. Riktig upptäckarglädje.</strong><p>En fristående skrivbordssimulator byggd med HTML, CSS och JavaScript. Kommandon och paket körs i det virtuella systemet. Dina filer stannar i den här webbläsaren.</p><small>Flin + Linux · Utgåva Glimten</small></div></div>`;
    function draw(){const d=DESKTOPS.find(d=>d.id===system.state.settings.desktop);const rows=[['Utgåva','1.0 Glimten'],['Skrivbord',d?.name||'Plasma'],['Användare',`${system.state.user.name}@flinux`],['Installerade paket',String(system.state.installed.length)],['Paketarkiv',`${Object.keys(PACKAGE_REGISTRY).length} paket`],['Lagring','Webbläsarens lokala lagring']];root.querySelector('[data-system-info]').innerHTML=rows.map(([k,v])=>`<div><small>${k}</small><strong>${esc(v)}</strong></div>`).join('');
      const services=root.querySelector('[data-services]');
      const known=system.state.installed.filter(name=>PACKAGE_REGISTRY[name]?.service).map(name=>[name,system.getService(name)]);services.innerHTML=known.map(([name,value])=>{const active=value.active===true;return `<div class="service-row"><span><i class="status-dot ${active?'':'offline'}"></i>${esc(name)}</span><small>${active?'Körs':'Stoppad'}</small><button class="button" data-service="${esc(name)}" data-active="${active}">${active?'Stoppa':'Starta'}</button></div>`;}).join('')||'<p class="muted">Installera apache2 för att prova en tjänst.</p>';
      services.querySelectorAll('[data-service]').forEach(b=>b.onclick=()=>{try{const action=b.dataset.active==='true'?'stop':'start';system.setService(b.dataset.service,action);toast(`${b.dataset.service}: ${action==='start'?'startad':'stoppad'}`);}catch(e){toast(e.message);}});
    }
    const unsubscribe=system.onChange(draw);draw();return unsubscribe;
  }

  function renderSnake(root) {
    root.innerHTML=`<div class="snake-app"><div class="snake-head"><strong>Snake<span>En klassiker som aldrig blir gammal.</span></strong><b data-score>0</b></div><canvas width="400" height="400" tabindex="0" aria-label="Snake. Styr med piltangenter eller WASD, mellanslag pausar."></canvas><p data-snake-status>Piltangenter / WASD · Mellanslag pausar</p><div class="snake-controls"><button class="button" data-direction="up" aria-label="Upp">↑</button><button class="button" data-direction="left" aria-label="Vänster">←</button><button class="button" data-direction="down" aria-label="Ner">↓</button><button class="button" data-direction="right" aria-label="Höger">→</button><button class="button primary" data-new>Ny omgång</button></div></div>`;
    const canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d'),status=root.querySelector('[data-snake-status]');let snake,food,direction,next,score,ended,paused;
    function placeFood(){const free=[];for(let y=0;y<20;y++)for(let x=0;x<20;x++)if(!snake.some(p=>p.x===x&&p.y===y))free.push({x,y});if(!free.length){ended=true;status.textContent='Hela spelplanen är din. Du vann!';return;}food=free[Math.floor(Math.random()*free.length)];}
    function draw(){ctx.fillStyle='#0c2224';ctx.fillRect(0,0,400,400);ctx.fillStyle='#173234';for(let y=0;y<20;y++)for(let x=0;x<20;x++)ctx.fillRect(x*20+9,y*20+9,2,2);ctx.fillStyle='#eeaf96';ctx.beginPath();ctx.arc(food.x*20+10,food.y*20+10,6,0,Math.PI*2);ctx.fill();snake.forEach((p,i)=>{ctx.fillStyle=i?'#70b69f':'#cbe9a2';ctx.fillRect(p.x*20+2,p.y*20+2,16,16);});root.querySelector('[data-score]').textContent=score;}
    function start(){snake=[{x:8,y:10},{x:7,y:10},{x:6,y:10}];direction={x:1,y:0};next=direction;score=0;ended=false;paused=false;status.textContent='Piltangenter / WASD · Mellanslag pausar';placeFood();draw();canvas.focus();}
    const steer=dir=>{const d={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}}[dir];if(d&&(d.x!==-direction.x||d.y!==-direction.y))next=d;};
    root.querySelectorAll('[data-direction]').forEach(b=>b.onclick=()=>{steer(b.dataset.direction);canvas.focus();});canvas.onkeydown=e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing||ended)return;const dir={ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right'}[e.key];if(dir){e.preventDefault();steer(dir);}if(e.code==='Space'){e.preventDefault();paused=!paused;status.textContent=paused?'Pausad. Mellanslag fortsätter.':'Piltangenter / WASD · Mellanslag pausar';}};root.querySelector('[data-new]').onclick=start;
    const timer=setInterval(()=>{if(ended||paused||root.closest('.window')?.hidden||!root.closest('.window')?.classList.contains('focused'))return;direction=next;const head={x:snake[0].x+direction.x,y:snake[0].y+direction.y},eat=head.x===food.x&&head.y===food.y,body=eat?snake:snake.slice(0,-1);if(head.x<0||head.x>=20||head.y<0||head.y>=20||body.some(p=>p.x===head.x&&p.y===head.y)){ended=true;status.textContent=`Bra spelat! ${score} poäng. Prova en gång till?`;return;}snake.unshift(head);if(eat){score+=10;placeFood();}else snake.pop();draw();},130);start();return()=>clearInterval(timer);
  }
  return {renderMarkdown,renderImages,renderClock,renderSysinfo,renderSnake};
}

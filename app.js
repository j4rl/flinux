import {system, DEFAULT_STATE, PACKAGE_REGISTRY} from './src/system.js';
import {createTerminalRenderer} from './src/terminal.js';
import {createWindowManager} from './src/window-manager.js';
import {createDesktopApps} from './src/desktop-apps.js';
import {createExtraApps} from './src/extra-apps.js';
import {createCreativeApps} from './src/creative-apps.js';
import {createTrainingApp} from './src/training-app.js';
import {icon, esc, DESKTOPS, WALLPAPERS} from './src/ui.js';

const launcher=document.querySelector('#launcher'),launcherButton=document.querySelector('#launcher-button'),search=document.querySelector('#app-search'),quickSettings=document.querySelector('#quick-settings'),contextMenu=document.querySelector('#context-menu');
let activeCategory='favorites',wm,settingsSignature='';
const renderTerminal=createTerminalRenderer({system,PACKAGE_REGISTRY,esc,toast,openApp,renderLauncherApps});
const desktopApps=createDesktopApps({system,PACKAGE_REGISTRY,openApp,toast,applySettings,renderLauncherApps});
const extras=createExtraApps({system,PACKAGE_REGISTRY,toast,applySettings});
const creative=createCreativeApps({system,toast});
const training=createTrainingApp({system,openApp,toast,applySettings,renderLauncherApps});
const app=(name,iconId,category,width,height,render,packageName)=>({name,icon:icon(iconId),iconId,category,width,height,render,package:packageName});
const apps={
  welcome:app('Välkommen till flinux','linux','system',740,528,desktopApps.renderWelcome),
  terminal:app('Terminal','terminal','system',770,488,renderTerminal,'konsole'),
  files:app('Filer','files','accessories',800,524,desktopApps.renderFiles,'dolphin'),
  discover:app('Discover · Paket','packages','system',880,660,desktopApps.renderDiscover),
  kate:app('Kate · Textredigerare','editor','accessories',740,520,desktopApps.renderKate,'kate'),
  settings:app('Inställningar','settings','settings',800,680,desktopApps.renderSettings),
  calculator:app('KCalc','help','accessories',360,440,creative.renderCalculator,'kcalc'),
  paint:app('flinux Paint','paint','graphics',800,584,creative.renderPaint,'paint'),
  mines:app('Röj','games','games',540,600,creative.renderMines,'mines'),
  btop:app('btop · Systemmonitor','monitor','system',920,620,creative.renderBtop,'btop'),
  markdown:app('Skriv · Markdown','editor','accessories',900,570,extras.renderMarkdown,'markdown'),
  'image-viewer':app('Bilder','image','graphics',860,580,extras.renderImages,'image-viewer'),
  clock:app('Klocka','clock','accessories',410,552,extras.renderClock,'clock'),
  sysinfo:app('Om flinux','linux','system',610,610,extras.renderSysinfo,'sysinfo'),
  snake:app('Snake','games','games',470,604,extras.renderSnake,'snake'),
  lab:app('Linux Lab','linux','system',930,650,training.renderTraining),
};
wm=createWindowManager({layer:document.querySelector('#window-layer'),taskbar:document.querySelector('#taskbar'),apps,system,toast,closeLauncher});
function openApp(id,options={}){hidePopovers();return wm.openApp(id,options);}
function toast(message){const el=document.createElement('div');el.className='toast';el.innerHTML=`${icon('check')}<span>${esc(message)}</span>`;document.querySelector('#toast-region').append(el);setTimeout(()=>el.remove(),4200);}
function closeLauncher(){launcher.hidden=true;launcherButton.classList.remove('active');launcherButton.setAttribute('aria-expanded','false');}
function hidePopovers(){closeLauncher();quickSettings.hidden=true;document.querySelector('#tray-button').setAttribute('aria-expanded','false');contextMenu.hidden=true;}
function toggleLauncher(){const open=launcher.hidden;hidePopovers();if(open){launcher.hidden=false;launcherButton.classList.add('active');launcherButton.setAttribute('aria-expanded','true');search.value='';renderLauncherApps();search.focus();}}

function availableApps(){return Object.entries(apps).filter(([id,a])=>id!=='welcome'&&(!a.package||system.state.installed.includes(a.package)));}
function renderLauncherApps(query=search.value){
  const categories=[['favorites','Favoriter','linux'],['all','Alla program','packages'],['accessories','Tillbehör','editor'],['graphics','Grafik','paint'],['games','Spel','games'],['system','System','terminal'],['settings','Inställningar','settings']];
  const nav=document.querySelector('#app-categories');nav.innerHTML=categories.map(([id,name,i])=>`<button data-category="${id}" class="${id===activeCategory?'active':''}">${icon(i)}${name}</button>`).join('');nav.querySelectorAll('button').forEach(b=>b.onclick=()=>{activeCategory=b.dataset.category;renderLauncherApps();});
  let entries=availableApps();if(!query){if(activeCategory==='favorites')entries=entries.filter(([id])=>['terminal','files','lab','discover','settings','kate','image-viewer','clock'].includes(id));else if(activeCategory!=='all')entries=entries.filter(([,a])=>a.category===activeCategory);}
  const grid=document.querySelector('#app-grid');grid.innerHTML='';entries.filter(([id,a])=>`${a.name} ${id} ${a.package||''}`.toLowerCase().includes(query.toLowerCase())).forEach(([id,a])=>{const b=document.createElement('button');b.className='app-tile';b.dataset.app=id;b.innerHTML=`<span class="app-icon ${a.category}">${a.icon}</span><span>${a.name.replace(' · Textredigerare','').replace(' · Paket','')}</span>`;b.onclick=()=>openApp(id);grid.append(b);});if(!grid.children.length)grid.innerHTML='<p class="empty-apps">Inga program här än.<br>Hitta något nytt i Discover.</p>';
}

function applySettings(){
  const s=system.state.settings={...DEFAULT_STATE.settings,...system.state.settings};
  if(!DESKTOPS.some(d=>d.id===s.desktop&&system.state.installed.includes(d.package)))s.desktop='plasma';
  const wallpaper=WALLPAPERS.find(w=>w.id===s.wallpaper)?.id||'glimten';
  document.documentElement.style.setProperty('--accent',/^#[0-9a-f]{6}$/i.test(s.accent)?s.accent:'#94dfc5');
  document.documentElement.style.setProperty('--accent-rgb',/^\d+,\s*\d+,\s*\d+$/.test(s.accentRgb)?s.accentRgb:'148, 223, 197');
  document.body.dataset.desktop=s.desktop;document.body.dataset.reduceMotion=String(Boolean(s.reduceMotion));document.body.dataset.wallpaper=wallpaper;
  document.querySelector('#desktop').style.backgroundImage=`url("assets/wallpapers/${wallpaper}.svg")`;
  launcherButton.querySelector('span').textContent=s.desktop==='gnome'?'Aktiviteter':'flinux';
  settingsSignature=JSON.stringify(s);
  wm?.applyLayout();
}

launcherButton.onclick=toggleLauncher;search.oninput=()=>renderLauncherApps();document.querySelector('#about-button').onclick=()=>openApp('sysinfo');
document.querySelector('#pinned-apps').innerHTML=['files','terminal','discover'].map(id=>`<button class="pinned-button" data-open="${id}" aria-label="${apps[id].name}" title="${apps[id].name}">${apps[id].icon}</button>`).join('');document.querySelectorAll('.pinned-button').forEach(b=>b.onclick=()=>openApp(b.dataset.open));
document.querySelector('#desktop-icons').innerHTML=[['files','Hemma'],['terminal','Terminal'],['lab','Linux Lab'],['discover','Paket'],['image-viewer','Bakgrunder']].map(([id,name])=>`<button class="desktop-icon" data-open="${id}"><span class="desktop-app-icon kind-${id}">${apps[id].icon}</span><span class="label">${name}</span></button>`).join('');
document.querySelectorAll('.desktop-icon').forEach(b=>{b.ondblclick=()=>openApp(b.dataset.open);b.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();openApp(b.dataset.open);}};b.addEventListener('pointerup',e=>{if(e.pointerType==='touch')openApp(b.dataset.open);});});

document.querySelector('#tray-button').onclick=()=>{
  const open=quickSettings.hidden;hidePopovers();if(!open)return;quickSettings.hidden=false;document.querySelector('#tray-button').setAttribute('aria-expanded','true');
  quickSettings.innerHTML=`<div class="quick-settings-head"><strong>En glad liten översikt</strong><small>${DESKTOPS.find(d=>d.id===system.state.settings.desktop)?.name} · arbetsyta ${wm.getActiveWorkspace()}</small></div><div class="quick-status"><span>${icon('wifi')} flinux-net<small>Virtuellt nätverk</small></span><span>${icon('packages')} ${system.state.installed.length} paket<small>Installerade</small></span></div><button class="button" data-open-settings>${icon('settings')} Öppna inställningar ${icon('arrow-right')}</button><button class="text-button" data-open-clock>${icon('clock')} Klocka & timer</button>`;
  quickSettings.querySelector('[data-open-settings]').onclick=()=>openApp('settings');quickSettings.querySelector('[data-open-clock]').onclick=()=>openApp('clock');
};
const desktopHidden=new Map();
document.querySelector('#show-desktop').onclick=()=>{const workspace=wm.getActiveWorkspace(),hidden=desktopHidden.get(workspace)||[];if(hidden.length){hidden.filter(w=>w.isConnected&&Number(w.dataset.workspace)===workspace).forEach(w=>wm.focusWindow(w));desktopHidden.delete(workspace);}else{const visible=wm.getWindows().filter(w=>!w.hidden);desktopHidden.set(workspace,visible);visible.forEach(w=>wm.minimizeWindow(w));}};

document.querySelector('#desktop').addEventListener('contextmenu',e=>{if(e.target.closest('.window,.launcher,.panel,.quick-settings'))return;e.preventDefault();hidePopovers();contextMenu.innerHTML=[['terminal','terminal','Öppna terminal'],['files','files','Öppna hemmappen'],['settings','settings','Anpassa skrivbordet'],['discover','packages','Installera paket'],['welcome','linux','Välkommen till flinux']].map(([id,i,label])=>`<button role="menuitem" data-open="${id}">${icon(i)}${label}</button>`).join('');contextMenu.hidden=false;contextMenu.style.left=`${Math.max(4,Math.min(e.clientX,innerWidth-254))}px`;contextMenu.style.top=`${Math.max(4,Math.min(e.clientY,innerHeight-260))}px`;contextMenu.querySelectorAll('button').forEach(b=>b.onclick=()=>openApp(b.dataset.open));contextMenu.querySelector('button').focus();});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#launcher,#launcher-button,#tray-button,#quick-settings,#context-menu'))hidePopovers();});
document.addEventListener('keydown',e=>{if(e.defaultPrevented)return;if(e.key==='Escape'&&(!launcher.hidden||!quickSettings.hidden||!contextMenu.hidden)){const focusTarget=!quickSettings.hidden?document.querySelector('#tray-button'):launcherButton;hidePopovers();focusTarget.focus();}if(e.ctrlKey&&!e.altKey&&e.code==='Space'){e.preventDefault();toggleLauncher();}});
function updateClock(){const now=new Date();document.querySelector('#clock').innerHTML=`<span>${now.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</span><small>${now.toLocaleDateString('sv-SE',{day:'numeric',month:'short'})}</small>`;}
system.onChange(()=>{renderLauncherApps();if(JSON.stringify(system.state.settings)!==settingsSignature)applySettings();if(system.storageError)toast(system.storageError);});
applySettings();renderLauncherApps();updateClock();setInterval(updateClock,1000);
if(system.state.settings.showWelcome!==false)openApp('welcome');
if(system.migratedFromLegacy)toast('Ditt tidigare Jarlix-system har följt med till flinux.');
if(system.storageError)toast(system.storageError);

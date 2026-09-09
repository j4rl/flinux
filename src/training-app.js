const SCENARIOS = [
  {
    id:'files',
    title:'Filer och kataloger',
    level:'Grund',
    summary:'Skapa en liten arbetsyta i din hemkatalog.',
    task:'Skapa katalogen ~/lab och filen answer.txt i den. Filen ska innehålla ordet flinux.',
    tools:['terminal','files','kate'],
    prepare(system){
      const path=system.normalize('~/lab');
      if(system.getNode(path)) system.remove(path);
    },
    check(system){
      const node=system.getNode('~/lab/answer.txt');
      return {ok:node?.type==='file'&&/flinux/i.test(node.content||''),detail:'~/lab/answer.txt finns och innehåller flinux'};
    }
  },
  {
    id:'text',
    title:'Textverktyg och pipelines',
    level:'Grund',
    summary:'Bearbeta en textfil med klassiska Linux-verktyg.',
    task:'I Dokument finns frukt.txt. Skapa unika.txt med frukterna sorterade och utan dubbletter.',
    tools:['terminal','files','kate'],
    prepare(system){
      system.writeFile('~/Documents/frukt.txt','päron\\näpple\\npäron\\nbanan\\näpple\\n');
      if(system.getNode('~/Documents/unika.txt')) system.remove('~/Documents/unika.txt');
    },
    check(system){
      const node=system.getNode('~/Documents/unika.txt');
      const normalized=(node?.content||'').trim().split(/\\n/).map(x=>x.trim()).filter(Boolean);
      return {ok:JSON.stringify(normalized)===JSON.stringify(['banan','päron','äpple'].sort((a,b)=>a.localeCompare(b,'sv'))),detail:'unika.txt innehåller tre sorterade, unika rader'};
    }
  },
  {
    id:'packages',
    title:'Installera program',
    level:'Grund',
    summary:'Använd pakethanteraren från GUI eller terminal.',
    task:'Installera cowsay. Du får använda Discover eller apt.',
    tools:['discover','terminal'],
    prepare(system){
      if(system.state.installed.includes('cowsay')) system.uninstall('cowsay');
    },
    check(system){
      return {ok:system.state.installed.includes('cowsay'),detail:'paketet cowsay är installerat'};
    }
  },
  {
    id:'apache',
    title:'Starta en tjänst',
    level:'Medel',
    summary:'Felsök en installerad men stoppad webbserver.',
    task:'Apache är installerad men webbplatsen svarar inte. Få apache2 till active (running).',
    tools:['terminal','sysinfo'],
    prepare(system){
      if(!system.state.installed.includes('apache2')) system.install('apache2');
      system.setService('apache2','stop');
    },
    check(system){
      return {ok:Boolean(system.getService('apache2').active),detail:'apache2 är active (running)'};
    }
  },
  {
    id:'website',
    title:'Redigera webbservern',
    level:'Medel',
    summary:'GUI-redigering och terminal kan arbeta mot samma virtuella filsystem.',
    task:'Ändra /var/www/html/index.html så att sidan innehåller texten "Flinux Lab". Starta Apache om det behövs.',
    tools:['files','kate','terminal'],
    prepare(system){
      if(!system.state.installed.includes('apache2')) system.install('apache2');
      system.setService('apache2','start');
      system.writeFile('/var/www/html/index.html','<!doctype html>\\n<html lang="sv"><title>Övning</title><h1>Reparera mig</h1></html>\\n');
    },
    check(system){
      const node=system.getNode('/var/www/html/index.html');
      return {ok:Boolean(system.getService('apache2').active&&/Flinux Lab/i.test(node?.content||'')),detail:'Apache är aktiv och index.html innehåller Flinux Lab'};
    }
  },
  {
    id:'desktop',
    title:'Byt skrivbordsmiljö',
    level:'Medel',
    summary:'Linux är mer än en terminal.',
    task:'Installera i3-wm och byt sedan aktiv skrivbordsmiljö till i3.',
    tools:['discover','settings','terminal'],
    prepare(system){
      if(system.state.settings.desktop==='i3') system.state.settings.desktop='plasma';
      if(system.state.installed.includes('i3-wm')) system.uninstall('i3-wm');
      system.save();
    },
    check(system){
      return {ok:system.state.installed.includes('i3-wm')&&system.state.settings.desktop==='i3',detail:'i3-wm är installerat och i3 är aktivt skrivbord'};
    }
  }
];

const labels={terminal:'Terminal',files:'Filer',kate:'Kate',discover:'Discover',settings:'Inställningar',sysinfo:'Systeminfo'};

export function createTrainingApp({system,openApp,toast,applySettings,renderLauncherApps}){
  let active=null,snapshot=null,completed=new Set();
  const restore=()=>{
    if(!snapshot)return;
    try{
      system.importState(snapshot);
      applySettings();
      renderLauncherApps();
      toast('Övningen är återställd.');
    }catch(error){toast(error.message);}
    snapshot=null;
  };
  const start=scenario=>{
    if(snapshot)restore();
    snapshot=structuredClone(system.state);
    active=scenario;
    try{
      scenario.prepare(system);
      applySettings();
      renderLauncherApps();
      toast('Övningen är klar att börja.');
    }catch(error){
      toast(error.message);
      active=null;
      snapshot=null;
    }
  };
  const verify=()=>{
    if(!active)return {ok:false,detail:'Välj och starta en övning.'};
    try{
      const result=active.check(system);
      if(result.ok)completed.add(active.id);
      return result;
    }catch(error){return {ok:false,detail:error.message};}
  };

  function renderTraining(root){
    root.innerHTML=`<div class="training-app">
      <aside class="training-sidebar">
        <div class="section-eyebrow">LINUX LAB</div>
        <h2>Öva i ditt eget system.</h2>
        <p>Övningarna förändrar det virtuella Flinux-systemet. Lös dem med samma skrivbord, filer, program och terminal som vanligt.</p>
        <div class="training-list"></div>
      </aside>
      <section class="training-main">
        <div class="training-hero">
          <span class="training-level">VÄLJ EN ÖVNING</span>
          <h1>Desktop först.<br><span>Linux på riktigt.</span></h1>
          <p>Här finns inget särskilt övningsskal. Uppgifterna sker i det vanliga Flinux-skrivbordet.</p>
        </div>
        <div class="training-task" hidden>
          <div class="training-task-head"><div><small data-level></small><h2 data-title></h2></div><span data-complete></span></div>
          <p data-summary></p>
          <div class="training-assignment"><strong>Uppgift</strong><p data-task></p></div>
          <div class="training-tools"></div>
          <div class="training-actions">
            <button class="button primary" data-check>Kontrollera</button>
            <button class="button" data-restart>Starta om övningen</button>
          </div>
          <div class="training-result" data-result>Arbeta i Flinux och kom tillbaka hit när du vill kontrollera resultatet.</div>
        </div>
      </section>
    </div>`;

    const list=root.querySelector('.training-list'),taskPanel=root.querySelector('.training-task'),hero=root.querySelector('.training-hero');
    const drawList=()=>{
      list.innerHTML='';
      for(const scenario of SCENARIOS){
        const button=document.createElement('button');
        button.className='training-item'+(active?.id===scenario.id?' active':'');
        button.innerHTML=`<span>${completed.has(scenario.id)?'✓':'○'}</span><div><strong>${scenario.title}</strong><small>${scenario.level} · ${scenario.summary}</small></div>`;
        button.onclick=()=>{start(scenario);drawList();drawTask();};
        list.append(button);
      }
    };
    const drawTask=()=>{
      if(!active){hero.hidden=false;taskPanel.hidden=true;return;}
      hero.hidden=true;taskPanel.hidden=false;
      taskPanel.querySelector('[data-level]').textContent=active.level.toUpperCase();
      taskPanel.querySelector('[data-title]').textContent=active.title;
      taskPanel.querySelector('[data-summary]').textContent=active.summary;
      taskPanel.querySelector('[data-task]').textContent=active.task;
      taskPanel.querySelector('[data-complete]').textContent=completed.has(active.id)?'KLAR':'PÅGÅR';
      const tools=taskPanel.querySelector('.training-tools');
      tools.innerHTML=active.tools.map(id=>`<button class="text-button" data-tool="${id}">${labels[id]||id} ↗</button>`).join('');
      tools.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>openApp(button.dataset.tool));
      taskPanel.querySelector('[data-result]').className='training-result';
      taskPanel.querySelector('[data-result]').textContent='Arbeta i Flinux och kom tillbaka hit när du vill kontrollera resultatet.';
    };
    taskPanel.querySelector('[data-check]').onclick=()=>{
      const result=verify(),box=taskPanel.querySelector('[data-result]');
      box.className='training-result '+(result.ok?'success':'pending');
      box.textContent=(result.ok?'✓ Klart: ':'Inte riktigt ännu: ')+result.detail;
      drawList();
      taskPanel.querySelector('[data-complete]').textContent=result.ok?'KLAR':'PÅGÅR';
    };
    taskPanel.querySelector('[data-restart]').onclick=()=>{
      if(!active)return;
      const scenario=active;
      restore();
      start(scenario);
      drawList();
      drawTask();
    };

    const unsubscribe=system.onChange(()=>{ if(active&&completed.has(active.id)){const result=verify();if(!result.ok)completed.delete(active.id);} drawList(); });
    drawList();drawTask();
    return ()=>{unsubscribe();};
  }
  return {renderTraining};
}

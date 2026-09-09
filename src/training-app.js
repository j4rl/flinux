import { createTrainingCore } from './training-core.js';

export function createTrainingApp({ system, openApp, toast }) {
  const training = createTrainingCore(system);

  function renderTraining(root) {
    const draw = () => {
      const active = training.labs.find(lab => lab.id === training.state.activeLab);
      const status = active ? training.checkLab() : null;

      root.innerHTML = `<div class="training-app">
        <aside class="training-sidebar">
          <div class="section-eyebrow">FLINUX LAB</div>
          <h2>Öva Linux i ett system du får förstöra.</h2>
          <p>Varje scenario ändrar det riktiga virtuella Flinux-systemet. Du väljer själv vilka kommandon som löser uppgiften.</p>
          <div class="training-list">
            ${training.labs.map(lab => `<button class="training-item ${active?.id === lab.id ? 'active' : ''}" data-start="${lab.id}">
              <span>${active?.id === lab.id && status?.ok ? '✓' : '○'}</span>
              <div><strong>${lab.title}</strong><small>${lab.level} · ${lab.description}</small></div>
            </button>`).join('')}
          </div>
        </aside>
        <section class="training-main">
          ${active ? `<div class="training-task">
            <div class="training-task-head">
              <div><small>${active.level.toUpperCase()}</small><h2>${active.title}</h2></div>
              <span>${status?.ok ? 'KLAR' : 'PÅGÅR'}</span>
            </div>
            <p>Flinux kontrollerar resultatet i systemet, inte vilken kommandosekvens du använde.</p>
            <div class="training-assignment"><strong>UPPGIFT</strong><p>${active.description}</p></div>
            <div class="training-tools">
              <button class="text-button" data-terminal>Terminal ↗</button>
              <button class="text-button" data-files>Filer ↗</button>
              <button class="text-button" data-hint>Visa tips</button>
            </div>
            <div class="training-actions">
              <button class="button primary" data-check>Kontrollera</button>
              <button class="button" data-restart>Starta om scenariot</button>
            </div>
            <div class="training-result ${status?.ok ? 'success' : 'pending'}" data-result>
              ${status ? (status.ok ? '✓ Klart: ' : 'Inte klart ännu: ') + status.message : ''}
            </div>
            <div class="training-result" data-hint-box hidden>Tips: ${active.hint}</div>
          </div>` : `<div class="training-hero">
            <span class="training-level">LINUX PÅ RIKTIGT — FAST VIRTUELLT</span>
            <h1>Gör fel.<br><span>Felsök. Lär dig.</span></h1>
            <p>Starta ett scenario. Använd sedan Flinux precis som ett Linux-system: terminal, filer, paket och tjänster delar samma systemtillstånd.</p>
          </div>`}
        </section>
      </div>`;

      root.querySelectorAll('[data-start]').forEach(button => {
        button.onclick = () => {
          try {
            const lab = training.startLab(button.dataset.start);
            toast(`${lab.title} startad`);
            draw();
          } catch (error) { toast(error.message); }
        };
      });
      root.querySelector('[data-terminal]')?.addEventListener('click', () => openApp('terminal'));
      root.querySelector('[data-files]')?.addEventListener('click', () => openApp('files'));
      root.querySelector('[data-hint]')?.addEventListener('click', () => {
        const box = root.querySelector('[data-hint-box]');
        if (box) box.hidden = !box.hidden;
      });
      root.querySelector('[data-check]')?.addEventListener('click', () => {
        const result = training.checkLab();
        toast(result.ok ? 'Labben är klar.' : result.message);
        draw();
      });
      root.querySelector('[data-restart]')?.addEventListener('click', () => {
        const id = training.state.activeLab;
        if (!id) return;
        training.resetLab();
        training.startLab(id);
        toast('Scenariot återställt.');
        draw();
      });
    };

    draw();
    const unsubscribe = system.onChange(() => { if (root.isConnected) draw(); });
    return () => unsubscribe();
  }

  return { renderTraining };
}

export function createCreativeApps({ system, toast }) {
  // Parse arithmetic directly so calculator input never becomes JavaScript.
  function calculate(expression) {
    const source = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.').replace(/\s/g, '');
    const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+*/-]/gi) || [];
    if (tokens.join('') !== source || !tokens.length) throw new Error('Kontrollera uttrycket');
    let position = 0;
    function primary() {
      if (tokens[position] === '+' || tokens[position] === '-') return tokens[position++] === '-' ? -primary() : primary();
      if (tokens[position] === '(') {
        position++;
        const value = sum();
        if (tokens[position++] !== ')') throw new Error('En parentes saknas');
        return value;
      }
      const token = tokens[position++];
      if (!token || !/^(?:\d|\.)/.test(token)) throw new Error('Kontrollera uttrycket');
      return Number(token);
    }
    function product() {
      let value = primary();
      while (tokens[position] === '*' || tokens[position] === '/') {
        const operator = tokens[position++], right = primary();
        if (operator === '/' && right === 0) throw new Error('Kan inte dela med noll');
        value = operator === '*' ? value * right : value / right;
      }
      return value;
    }
    function sum() {
      let value = product();
      while (tokens[position] === '+' || tokens[position] === '-') {
        const operator = tokens[position++], right = product();
        value = operator === '+' ? value + right : value - right;
      }
      return value;
    }
    const result = sum();
    if (position !== tokens.length) throw new Error('Kontrollera uttrycket');
    if (!Number.isFinite(result)) throw new Error('Talet är för stort');
    return String(Number(result.toPrecision(12)));
  }

  function renderCalculator(root) {
    const keys = ['C', '(', ')', '⌫', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '=', '+'];
    root.innerHTML = `<div style="padding:18px;height:100%;display:grid;grid-template-rows:76px 1fr;gap:12px"><output aria-label="Resultat" aria-live="polite" style="background:#0f2425;border:1px solid var(--border);border-radius:10px;padding:20px;text-align:right;font:24px monospace;overflow:auto;white-space:nowrap">0</output><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px">${keys.map(key => `<button class="button" type="button" data-key="${key}"${key === '⌫' ? ' aria-label="Radera senaste tecknet"' : ''}>${key}</button>`).join('')}</div></div>`;
    let value = '', completed = false, failed = false;
    const output = root.querySelector('output');
    function press(key) {
      if (key === 'C') { value = ''; completed = false; failed = false; }
      else if (key === '⌫') { value = failed ? '' : value.slice(0, -1); completed = false; failed = false; }
      else if (key === '=') {
        try { value = value ? calculate(value) : '0'; completed = true; failed = false; }
        catch (error) { output.textContent = error.message; failed = true; return; }
      } else {
        if (failed || (completed && /^[\d.(]$/.test(key))) value = '';
        failed = false; completed = false;
        if (value.length < 128) value += key;
      }
      output.textContent = value || '0';
      output.scrollLeft = output.scrollWidth;
    }
    root.querySelectorAll('[data-key]').forEach(button => { button.onclick = () => press(button.dataset.key); });
    root.tabIndex = 0;
    const onKey = event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = { Enter: '=', Escape: 'C', Backspace: '⌫', Delete: 'C', '*': '×', '/': '÷', '-': '−', ',': '.' }[event.key] || event.key;
      if (keys.includes(key)) { event.preventDefault(); event.stopPropagation(); press(key); }
    };
    root.addEventListener('keydown', onKey);
    root.focus({ preventScroll: true });
    return () => root.removeEventListener('keydown', onKey);
  }

  function renderPaint(root) {
    root.innerHTML = `<div class="paint-app"><div class="paint-tools"><label>Färg <input type="color" value="#153d37" data-paint-color></label><label>Storlek <input type="range" min="1" max="40" value="6" data-paint-size></label><button class="button" data-paint-clear>Rensa</button><button class="button" data-paint-save>Spara i Bilder</button><button class="button" data-paint-export>Ladda ner PNG</button></div><div class="paint-stage"><canvas width="1100" height="700" aria-label="Rityta" style="touch-action:none"></canvas></div></div>`;
    const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
    const color = root.querySelector('[data-paint-color]'), size = root.querySelector('[data-paint-size]');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let drawing = false, activePointer = null;
    const point = event => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
    };
    canvas.onpointerdown = event => {
      if (event.button !== 0 || drawing) return;
      event.preventDefault(); drawing = true; activePointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      const p = point(event);
      ctx.fillStyle = color.value; ctx.beginPath(); ctx.arc(p.x, p.y, Number(size.value) / 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
    };
    canvas.onpointermove = event => {
      if (!drawing || event.pointerId !== activePointer) return;
      const p = point(event);
      ctx.strokeStyle = color.value; ctx.lineWidth = Number(size.value); ctx.lineTo(p.x, p.y); ctx.stroke();
    };
    const endStroke = event => {
      if (event.pointerId !== activePointer) return;
      drawing = false; activePointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.onpointerup = endStroke; canvas.onpointercancel = endStroke; canvas.onlostpointercapture = endStroke;
    root.querySelector('[data-paint-clear]').onclick = () => { drawing = false; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); };
    root.querySelector('[data-paint-save]').onclick = () => {
      try {
        const directory = `${system.state.user.home}/Pictures`;
        if (!system.getNode(directory)) system.mkdir(directory);
        const stamp = new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');
        let filename = `ritning-${stamp}.png`, copy = 2;
        while (system.getNode(`${directory}/${filename}`)) filename = `ritning-${stamp}-${copy++}.png`;
        system.writeFile(`${directory}/${filename}`, canvas.toDataURL('image/png'));
        toast(system.storageError || `Sparad i Bilder: ${filename}`);
      } catch (error) { toast(error.message); }
    };
    root.querySelector('[data-paint-export]').onclick = () => {
      const link = document.createElement('a');
      link.download = 'flinux-ritning.png'; link.href = canvas.toDataURL('image/png'); link.click();
      toast('PNG-bilden är klar för nedladdning');
    };
    return () => { drawing = false; canvas.onpointerdown = canvas.onpointermove = canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = null; };
  }

  function renderMines(root) {
    root.innerHTML = `<div class="mines-app"><div class="mines-head"><div><strong>Röj</strong><small data-mines-status aria-live="polite">10 minor</small></div><select class="button" data-level aria-label="Svårighetsgrad"><option value="9,9,10">Nybörjare</option><option value="12,12,22">Medel</option><option value="16,16,40">Svår</option></select><button class="button" data-new-game>Ny omgång</button></div><div class="mine-board" aria-label="Minfält"></div><small style="display:block;padding:10px 16px;color:var(--muted)">Högerklicka för att flagga. Första klicket är alltid säkert.</small></div>`;
    const board = root.querySelector('.mine-board'), status = root.querySelector('[data-mines-status]'), level = root.querySelector('[data-level]');
    let cells = [], rows, cols, mineCount, ended = false, initialized = false;
    function neighbors(index) {
      const row = Math.floor(index / cols), col = index % cols, result = [];
      for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
        const nextRow = row + y, nextCol = col + x;
        if ((x || y) && nextRow >= 0 && nextRow < rows && nextCol >= 0 && nextCol < cols) result.push(nextRow * cols + nextCol);
      }
      return result;
    }
    function placeMines(first) {
      const safe = new Set([first, ...neighbors(first)]);
      const candidates = cells.map((_, index) => index).filter(index => !safe.has(index));
      for (let placed = 0; placed < mineCount; placed++) {
        const selected = placed + Math.floor(Math.random() * (candidates.length - placed));
        [candidates[placed], candidates[selected]] = [candidates[selected], candidates[placed]];
        cells[candidates[placed]].mine = true;
      }
      cells.forEach((cell, index) => { cell.near = neighbors(index).filter(next => cells[next].mine).length; });
      initialized = true;
    }
    function updateCount() { status.textContent = `${mineCount - cells.filter(cell => cell.flag).length} minor kvar`; }
    function start() {
      [rows, cols, mineCount] = level.value.split(',').map(Number);
      ended = false; initialized = false;
      cells = Array.from({ length: rows * cols }, () => ({ mine: false, open: false, flag: false, near: 0 }));
      board.style.gridTemplateColumns = `repeat(${cols},1fr)`;
      updateCount(); draw();
    }
    function reveal(index) {
      const first = cells[index];
      if (ended || first.open || first.flag) return;
      if (!initialized) placeMines(index);
      if (first.mine) {
        ended = true;
        cells.forEach(cell => { if (cell.mine) cell.open = true; });
        status.textContent = 'En mina! Prova en ny omgång.';
      } else {
        const pending = [index];
        while (pending.length) {
          const next = pending.pop(), cell = cells[next];
          if (cell.open || cell.flag || cell.mine) continue;
          cell.open = true;
          if (!cell.near) pending.push(...neighbors(next));
        }
        if (cells.every(cell => cell.mine || cell.open)) {
          ended = true;
          cells.forEach(cell => { if (cell.mine) cell.flag = true; });
          status.textContent = 'Du vann! Alla minor är hittade.';
        }
      }
      draw();
    }
    function flag(index) {
      const cell = cells[index];
      if (cell.open || ended) return;
      if (!cell.flag && cells.filter(item => item.flag).length >= mineCount) return;
      cell.flag = !cell.flag; updateCount(); draw();
    }
    function draw() {
      const focusedIndex = board.contains(document.activeElement) ? Number(document.activeElement.dataset.index) : null;
      board.replaceChildren();
      cells.forEach((cell, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.index = index;
        button.className = `mine-cell ${cell.open ? 'open' : ''}`;
        button.textContent = cell.open ? (cell.mine ? '✹' : cell.near || '') : (cell.flag ? '⚑' : '');
        const state = cell.open ? (cell.mine ? 'mina' : `${cell.near} närliggande minor`) : (cell.flag ? 'flaggad' : 'dold');
        button.setAttribute('aria-label', `Rad ${Math.floor(index / cols) + 1}, kolumn ${index % cols + 1}, ${state}`);
        if (cell.open && cell.near) button.dataset.near = cell.near;
        button.onclick = () => reveal(index);
        button.oncontextmenu = event => { event.preventDefault(); flag(index); };
        button.onkeydown = event => {
          if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
          if (event.key.toLowerCase() === 'f') { event.preventDefault(); flag(index); }
          const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
          if (event.key in offsets) {
            event.preventDefault();
            const next = Math.max(0, Math.min(cells.length - 1, index + offsets[event.key]));
            board.querySelector(`[data-index="${next}"]`)?.focus();
          }
        };
        board.append(button);
      });
      if (focusedIndex !== null) board.querySelector(`[data-index="${focusedIndex}"]`)?.focus({ preventScroll: true });
    }
    root.querySelector('[data-new-game]').onclick = start;
    level.onchange = start; start();
  }

  function renderBtop(root) {
    root.innerHTML = `<div class="btop"><header class="btop-header"><strong><i>b</i>top</strong><span data-btop-time></span><span class="btop-menu">Simulerade resurser · q Stäng</span></header><div class="btop-grid"><section class="btop-box cpu"><h3>CPU <span data-cpu-label>0%</span></h3><canvas data-cpu-chart aria-label="Simulerad CPU-användning"></canvas><div class="cpu-cores">${[0, 1, 2, 3].map(index => `<div><span>Kärna ${index + 1}</span><b data-core="${index}">0%</b><em><i data-core-bar="${index}"></i></em></div>`).join('')}</div></section><section class="btop-box memory"><h3>MINNE</h3><div class="meter"><span>Använt</span><b data-mem-label></b><em><i data-mem-bar></i></em></div><div class="meter"><span>Cache</span><b>824 MiB</b><em><i style="width:20%"></i></em></div><div class="meter"><span>Tillgängligt</span><b data-available></b><em><i class="cyan" data-avail-bar></i></em></div><h3 class="disk-title">VIRTUELLA FILER <span>/</span></h3><div class="meter"><span>Filer</span><b data-file-count></b></div><div class="meter"><span>Innehåll</span><b data-disk-size></b></div><small data-directory-count></small></section><section class="btop-box network"><h3>NÄTVERK <span>eth0 · simulerat</span></h3><canvas data-net-chart aria-label="Simulerad nätverkstrafik"></canvas><div class="net-values"><span>▼ <b data-down>0 KiB/s</b></span><span>▲ <b data-up>0 KiB/s</b></span></div></section><section class="btop-box processes"><h3>PROCESSER <span data-task-count></span></h3><div class="process-head"><span>PID</span><span>Program</span><span>CPU%</span><span>MEM%</span></div><div data-process-list></div></section></div><footer class="btop-footer"><span>CPU, minne och nätverk är simulerade</span><span>Uppdateras var 850 ms</span></footer></div>`;
    const cpuCanvas = root.querySelector('[data-cpu-chart]'), netCanvas = root.querySelector('[data-net-chart]');
    const cpuHistory = Array(70).fill(8), downHistory = Array(70).fill(4), upHistory = Array(70).fill(2);
    let tick = 0, disposed = false, timer = null;
    const pids = new Map([['core', 1], ['desktop', 12]]);
    let nextPid = 100;
    function processes() {
      const desktop = { plasma: 'plasma-desktop', gnome: 'gnome-shell', xfce: 'xfce4-session', i3: 'i3', openbox: 'openbox' }[system.state.settings.desktop] || 'plasma-desktop';
      const active = [{ key: 'core', name: 'flinux-core' }, { key: 'desktop', name: desktop }];
      root.ownerDocument.querySelectorAll('.window[data-app]').forEach(win => { active.push({ key: `window:${win.dataset.id}`, name: win.dataset.app }); });
      Object.entries(system.state.services).filter(([, service]) => service.active).forEach(([name]) => { active.push({ key: `service:${name}`, name }); });
      return active.map(process => {
        if (!pids.has(process.key)) pids.set(process.key, nextPid++);
        return { ...process, pid: pids.get(process.key) };
      });
    }
    function chart(canvas, series, colors, max = 100) {
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 2), rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
      const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 1;
      for (let y = 0; y < 4; y++) { ctx.beginPath(); ctx.moveTo(0, y * rect.height / 3); ctx.lineTo(rect.width, y * rect.height / 3); ctx.stroke(); }
      series.forEach((values, index) => {
        const color = colors[index], gradient = ctx.createLinearGradient(0, 0, 0, rect.height);
        gradient.addColorStop(0, `${color}66`); gradient.addColorStop(1, `${color}05`);
        const trace = () => values.forEach((value, i) => {
          const x = i * rect.width / (values.length - 1), y = rect.height - value / max * rect.height;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.beginPath(); trace(); ctx.lineTo(rect.width, rect.height); ctx.lineTo(0, rect.height); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
        ctx.beginPath(); trace(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      });
    }
    function update() {
      if (disposed) return;
      if (!root.isConnected) { dispose(); return; }
      tick++;
      const running = processes(), wave = Math.sin(tick / 3) * 8;
      const cpu = Math.max(3, Math.min(96, Math.round(8 + running.length * 3 + wave + Math.random() * 14)));
      const cores = [0, 1, 2, 3].map(() => Math.max(1, Math.min(99, Math.round(cpu + Math.random() * 18 - 9))));
      cpuHistory.push(cpu); cpuHistory.shift();
      const down = Math.max(1, 35 + Math.sin(tick / 2) * 24 + Math.random() * 30), up = Math.max(1, 12 + Math.cos(tick / 2.7) * 8 + Math.random() * 12);
      downHistory.push(down); downHistory.shift(); upHistory.push(up); upHistory.shift();
      root.querySelector('[data-cpu-label]').textContent = `${cpu}%`;
      cores.forEach((value, index) => { root.querySelector(`[data-core="${index}"]`).textContent = `${value}%`; root.querySelector(`[data-core-bar="${index}"]`).style.width = `${value}%`; });
      const mem = Math.min(92, 27 + running.length * 2 + Math.round(Math.sin(tick / 8) * 3));
      root.querySelector('[data-mem-label]').textContent = `${(4 * mem / 100).toFixed(1)} GiB / 4 GiB`;
      root.querySelector('[data-mem-bar]').style.width = `${mem}%`;
      root.querySelector('[data-available]').textContent = `${(4 * (100 - mem) / 100).toFixed(1)} GiB`;
      root.querySelector('[data-avail-bar]').style.width = `${100 - mem}%`;
      root.querySelector('[data-down]').textContent = `${down.toFixed(1)} KiB/s`;
      root.querySelector('[data-up]').textContent = `${up.toFixed(1)} KiB/s`;
      root.querySelector('[data-btop-time]').textContent = new Date().toLocaleTimeString('sv-SE');
      const stats = system.filesystemStats('/');
      root.querySelector('[data-file-count]').textContent = stats.files;
      root.querySelector('[data-disk-size]').textContent = stats.bytes > 1024 * 1024 ? `${(stats.bytes / 1024 / 1024).toFixed(1)} MiB` : `${(stats.bytes / 1024).toFixed(1)} KiB`;
      root.querySelector('[data-directory-count]').textContent = `${stats.directories} kataloger i flinux`;
      root.querySelector('[data-task-count]').textContent = `${running.length} processer`;
      const processList = root.querySelector('[data-process-list]'); processList.replaceChildren();
      const weights = running.map(() => .25 + Math.random()), weightSum = weights.reduce((total, weight) => total + weight, 0);
      running.map((process, index) => ({ ...process, cpu: cpu * weights[index] / weightSum, mem: mem * weights[index] / weightSum })).sort((a, b) => b.cpu - a.cpu).forEach((process, index) => {
        const row = document.createElement('div'); row.className = `process-row ${index === 0 ? 'hot' : ''}`;
        [process.pid, process.name, process.cpu.toFixed(1), process.mem.toFixed(1)].forEach(value => { const span = document.createElement('span'); span.textContent = value; row.append(span); });
        processList.append(row);
      });
      chart(cpuCanvas, [cpuHistory], ['#c4eea2']); chart(netCanvas, [downHistory, upHistory], ['#69d5c5', '#e9a35f']);
    }
    function onKey(event) {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key.toLowerCase() === 'q' || event.key === 'Escape')) {
        event.preventDefault(); event.stopPropagation(); root.closest('.window')?.querySelector('[data-action=close]')?.click();
      }
    }
    function dispose() { disposed = true; clearInterval(timer); root.removeEventListener('keydown', onKey); }
    root.tabIndex = 0; root.addEventListener('keydown', onKey);
    timer = setInterval(update, 850); update(); root.focus({ preventScroll: true });
    return dispose;
  }

  return { renderCalculator, renderPaint, renderMines, renderBtop };
}

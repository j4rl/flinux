const clone = value => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const file = content => ({ type: 'file', content, mode: '644' });
const dir = children => ({ type: 'dir', children, mode: '755' });

const PACKAGE_REGISTRY = {
  coreutils: { description: 'Filer, kataloger, rättigheter, sortering och textverktyg', icon: '⚙', size: 312, core: true },
  konsole: { description: 'Terminal med pipelines, historik och flikkomplettering', icon: '▸', size: 840, app: 'terminal', core: true },
  dolphin: { description: 'Utforska och hantera det virtuella filsystemet', icon: '📁', size: 1260, app: 'files', core: true },
  'plasma-desktop': { description: 'Plasma-inspirerat skrivbord med panel och fönster', icon: '◆', size: 4200, desktop: 'plasma', core: true },
  kate: { description: 'Textredigerare som sparar i ditt virtuella filsystem', icon: '📝', size: 980, app: 'kate' },
  neofetch: { description: 'Visa flinux-version, skrivbord, paket och drifttid', icon: '◡', size: 94, command: 'neofetch' },
  tree: { description: 'Skriv ut kataloger som ett filträd', icon: '⑂', size: 48, command: 'tree' },
  grep: { description: 'Filtrera text med reguljära uttryck', icon: '⌕', size: 74, command: 'grep' },
  cowsay: { description: 'En ASCII-ko som pratar med text eller en pipeline', icon: '🐄', size: 36, command: 'cowsay' },
  fortune: { description: 'Små bitar terminalvisdom', icon: '🥠', size: 22, command: 'fortune' },
  snake: { description: 'Spela Snake med piltangenterna', icon: '🐍', size: 148, command: 'snake', app: 'snake' },
  nano: { description: 'Öppna och redigera en fil i Kate från terminalen', icon: '✎', size: 28, command: 'nano', dependencies: ['kate'] },
  htop: { description: 'Översikt över simulatorns processer och tjänster', icon: '▥', size: 176, command: 'htop' },
  apache2: { description: 'Virtuell webbserver: systemctl start apache2; curl localhost', icon: '🌐', size: 2140, command: 'apachectl', service: 'apache2' },
  btop: { description: 'Grafisk översikt över simulerade resurser', icon: '▤', size: 892, command: 'btop', app: 'btop' },
  paint: { description: 'Rita och spara bilder', icon: '🎨', size: 524, app: 'paint' },
  mines: { description: 'Klassiska Röj med tre svårighetsgrader', icon: '💣', size: 184, app: 'mines' },
  kcalc: { description: 'Skrivbordskalkylator', icon: '🧮', size: 410, app: 'calculator', command: 'kcalc' },
  markdown: { description: 'Skriv och förhandsvisa Markdown-dokument', icon: 'M↓', size: 234, app: 'markdown' },
  'image-viewer': { description: 'Visa sparade bilder och flinux-bakgrunder', icon: '▧', size: 156, app: 'image-viewer' },
  clock: { description: 'Klocka, stoppur och timer', icon: '◷', size: 96, app: 'clock' },
  sysinfo: { description: 'Systeminformation om din flinux-session', icon: 'ⓘ', size: 88, app: 'sysinfo' },
  'gnome-shell': { description: 'GNOME-inspirerad toppanel och programöversikt', icon: '●', size: 3800, desktop: 'gnome' },
  xfce4: { description: 'Klassiskt och kompakt skrivbord', icon: '🐭', size: 2200, desktop: 'xfce' },
  'i3-wm': { description: 'Fönster sida vid sida och tangentbordsstyrning', icon: '▦', size: 720, desktop: 'i3' },
  openbox: { description: 'Avskalat skrivbord med fria fönster', icon: '□', size: 480, desktop: 'openbox' },
  sed: { description: "Ersätt text med sed 's/gammalt/nytt/g'", icon: '⇄', size: 112, command: 'sed' },
  jq: { description: 'Filtrera JSON med .fält, .[], length och keys', icon: '{}', size: 196, command: 'jq' },
  figlet: { description: 'Skriv text med stora blockbokstäver', icon: 'Aa', size: 86, command: 'figlet' },
  less: { description: 'Öppna en textfil i terminalens läsvy', icon: '≡', size: 64, command: 'less' },
  curl: { description: 'Läs från virtuell Apache eller file://', icon: '↧', size: 240, command: 'curl' },
  wget: { description: 'Spara en resurs från den virtuella webbservern', icon: '⇩', size: 160, command: 'wget', dependencies: ['curl'] },
  'flinux-archive': { description: 'Packa och återställ filer som ett .flar JSON-arkiv', icon: '▣', size: 92, command: 'archive' },
  base64: { description: 'Koda och avkoda UTF-8-text som Base64', icon: '64', size: 24, command: 'base64' },
  diffutils: { description: 'Jämför innehållet i två textfiler', icon: '±', size: 80, command: 'diff' },
  cal: { description: 'Skriv ut en månadskalender', icon: '▦', size: 32, command: 'cal' }
};
for (const pkg of Object.values(PACKAGE_REGISTRY)) { pkg.version = '1.0'; pkg.dependencies ??= []; }

const DEFAULT_STATE = {
  schemaVersion: 2,
  user: { name: 'jarl', host: 'flinux', home: '/home/jarl' },
  cwd: '/home/jarl',
  settings: { accent: '#94dfc5', accentRgb: '148, 223, 197', desktop: 'plasma', wallpaper: 'glimten', showWelcome: true, reduceMotion: false },
  installed: ['coreutils', 'konsole', 'dolphin', 'plasma-desktop', 'kate', 'neofetch', 'tree', 'grep', 'image-viewer', 'clock', 'sysinfo'],
  services: {}, packageLog: [],
  filesystem: dir({
    home: dir({ jarl: dir({
      Desktop: dir({}),
      Documents: dir({
        'välkommen.txt': file('Välkommen till flinux 1.0 Glimten!\nDet glada linuxet — flin + Linux.\n\nDet här är ett virtuellt Linux-inspirerat skrivbord i webbläsaren.\nFiler och paket sparas lokalt i den här webbläsaren.\n\nProva terminalen:\n  help\n  ls -la\n  echo "Hej flinux!" > hej.txt\n  cat hej.txt | grep flinux\n  sudo apt install cowsay fortune\n  fortune | cowsay\n\nByt skrivbord i Inställningar och hitta fler program i Discover.\n'),
        'kom-igång.md': file('# flinux\n\n**Det glada linuxet** — ditt lilla Linux i webbläsaren.\n\n- Filer, terminal och appar delar samma filsystem.\n- Installera program i Discover eller med `apt install`.\n- Prova Plasma, GNOME, XFCE, i3 och Openbox i Inställningar.\n\n## En liten pipeline\n\n```sh\nprintf "päron\\näpple\\npäron\\n" | sort | uniq\n```\n\nAllt är en simulator. Kommandon påverkar enbart det virtuella systemet.\n')
      }),
      Downloads: dir({}), Pictures: dir({
        'Glimten.svg': file('flinux-wallpaper:glimten'),
        'Midnatt.svg': file('flinux-wallpaper:midnatt'),
        'Gryning.svg': file('flinux-wallpaper:gryning'),
        'Terminal.svg': file('flinux-wallpaper:terminal')
      }),
      '.bashrc': file('export USER=jarl\nexport HOME=/home/jarl\nexport SHELL=/bin/flinux\n')
    }) }),
    etc: dir({ 'os-release': file('NAME="flinux"\nVERSION="1.0 Glimten"\nID=flinux\nPRETTY_NAME="flinux 1.0 Glimten — Det glada linuxet"\n') }),
    usr: dir({ bin: dir({}), share: dir({}) }),
    var: dir({ log: dir({ 'apt.log': file('') }), www: dir({ html: dir({ 'index.html': file('<!doctype html>\n<html lang="sv"><title>flinux Apache</title><h1>Det glada linuxet</h1><p>Din virtuella Apache-server fungerar!</p></html>\n') }) }) }),
    tmp: dir({})
  })
};

function sanitizeNode(node, depth = 0) {
  if (!node || depth > 80) throw new Error('Ogiltigt filsystem');
  const mode = /^[0-7]{3}$/.test(node.mode) ? node.mode : node.type === 'dir' ? '755' : '644';
  const metadata = { mode, modified: Number.isFinite(node.modified) ? node.modified : Date.now(), owner: typeof node.owner === 'string' ? node.owner : undefined, group: typeof node.group === 'string' ? node.group : undefined };
  if (node.type === 'file') return { type: 'file', content: String(node.content ?? ''), ...metadata };
  if (node.type !== 'dir' || !node.children || typeof node.children !== 'object') throw new Error('Ogiltig katalog');
  const children = Object.create(null);
  for (const [name, child] of Object.entries(node.children)) {
    if (!name || name === '.' || name === '..' || /[\/\0]/.test(name)) continue;
    children[name] = sanitizeNode(child, depth + 1);
  }
  return { type: 'dir', children, ...metadata };
}

function sanitizeSettings(settings) {
  const safe = { ...DEFAULT_STATE.settings };
  if (!settings || typeof settings !== 'object') return safe;
  if (/^#[0-9a-f]{6}$/i.test(settings.accent)) {
    safe.accent = settings.accent;
    safe.accentRgb = [1, 3, 5].map(offset => parseInt(settings.accent.slice(offset, offset + 2), 16)).join(', ');
  }
  if (['plasma', 'gnome', 'xfce', 'i3', 'openbox'].includes(settings.desktop)) safe.desktop = settings.desktop;
  if (['glimten', 'midnatt', 'gryning', 'terminal'].includes(settings.wallpaper)) safe.wallpaper = settings.wallpaper;
  for (const key of ['showWelcome', 'reduceMotion']) if (typeof settings[key] === 'boolean') safe[key] = settings[key];
  return safe;
}

class SystemCore {
  constructor(options = {}) {
    this.listeners = new Set(); this.now = options.now || (() => Date.now()); this.startedAt = this.now();
    this.storageError = null; this.migratedFromLegacy = false;
    this.reload = options.reload || (() => globalThis.location?.reload());
    try { this.storage = own(options, 'storage') ? options.storage : typeof window === 'undefined' ? null : globalThis.localStorage; }
    catch { this.storage = null; this.storageError = 'Lokal lagring är blockerad; ändringar finns kvar under den här sessionen.'; }
    let persisted = null;
    try {
      const current = this.storage?.getItem('flinux-state'), legacy = current == null ? this.storage?.getItem('jarlix-state') : null;
      if (current || legacy) persisted = JSON.parse(current || legacy);
      this.migratedFromLegacy = !current && !!legacy;
    } catch { this.storageError = 'Sparade data kunde inte läsas. flinux kör en ny session.'; }
    this.state = clone(DEFAULT_STATE);
    if (persisted && typeof persisted === 'object') {
      try {
        if (persisted.filesystem) {
          if (persisted.filesystem.type !== 'dir') throw new Error('Roten måste vara en katalog');
          this.state.filesystem = sanitizeNode(persisted.filesystem);
        }
        this.state.settings = sanitizeSettings(persisted.settings);
        this.state.installed = [...new Set([...(Array.isArray(persisted.installed) ? persisted.installed : this.state.installed), ...Object.keys(PACKAGE_REGISTRY).filter(name => PACKAGE_REGISTRY[name].core)])].filter(name => own(PACKAGE_REGISTRY, name));
        this.state.cwd = typeof persisted.cwd === 'string' ? persisted.cwd : DEFAULT_STATE.cwd;
        this.state.packageLog = Array.isArray(persisted.packageLog) ? persisted.packageLog.filter(x => typeof x === 'string').slice(-100) : [];
        const desktopPackage = Object.keys(PACKAGE_REGISTRY).find(name => PACKAGE_REGISTRY[name].desktop === this.state.settings.desktop);
        if (desktopPackage && this.migratedFromLegacy && !this.state.installed.includes(desktopPackage)) this.state.installed.push(desktopPackage);
        if (!desktopPackage || !this.state.installed.includes(desktopPackage)) this.state.settings.desktop = 'plasma';
        for (const [name, service] of Object.entries(persisted.services || {})) {
          if (this.state.installed.includes(name) && PACKAGE_REGISTRY[name]?.service && service) this.state.services[name] = { active: !!service.active, enabled: !!service.enabled, since: Number(service.since) || this.now() };
        }
      } catch { this.state = clone(DEFAULT_STATE); this.storageError = 'Sparade data var skadade. flinux kör en ny session.'; }
    }
    this.state.filesystem = sanitizeNode(this.state.filesystem);
    if (this.migratedFromLegacy) this.ensureDefaults(DEFAULT_STATE.filesystem, this.state.filesystem);
    this.ensureSystemDirectories();
    const release = this.getNode('/etc/os-release'); if (release?.type === 'file') release.content = DEFAULT_STATE.filesystem.children.etc.children['os-release'].content;
    if (this.getNode(this.state.cwd)?.type !== 'dir') this.state.cwd = this.state.user.home;
    for (const name of [...this.state.installed]) this.installDependencies(name);
    this.syncExecutables(); if (this.migratedFromLegacy) this.save();
  }
  ensureDefaults(template, target) {
    if (target.type !== 'dir') return;
    for (const [name, child] of Object.entries(template.children)) {
      if (!own(target.children, name)) target.children[name] = sanitizeNode(child);
      else if (child.type === 'dir') this.ensureDefaults(child, target.children[name]);
    }
  }
  ensureSystemDirectories() {
    for (const path of ['/home', '/home/jarl', '/etc', '/usr', '/usr/bin', '/usr/share', '/var', '/var/log', '/var/www', '/var/www/html', '/tmp']) {
      if (!this.getNode(path)) { const parent = this.parent(path); if (parent.node?.type === 'dir') parent.node.children[parent.name] = sanitizeNode(dir({})); }
    }
    for (const path of ['/etc/os-release', '/var/log/apt.log']) {
      if (!this.getNode(path)) { const parent = this.parent(path); if (parent.node?.type === 'dir') parent.node.children[parent.name] = sanitizeNode(file('')); }
    }
  }
  importState(data) {
    // Validate first in an isolated core. Failed imports leave the active state intact.
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.filesystem?.type !== 'dir' || !Array.isArray(data.installed)) throw new Error('Filen är inte en giltig flinux-säkerhetskopia.');
    if (data.schemaVersion != null && (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1 || data.schemaVersion > 2)) throw new Error('Säkerhetskopians version stöds inte.');
    if (!data.installed.every(name => typeof name === 'string')) throw new Error('Säkerhetskopians paketlista är ogiltig.');
    const filesystem = sanitizeNode(data.filesystem);
    const candidate = new SystemCore({ storage: { getItem: key => key === 'flinux-state' ? JSON.stringify({ ...data, filesystem }) : null, setItem: () => {} }, now: this.now, reload: () => {} });
    for (const path of ['/', '/home', '/home/jarl', '/etc', '/usr', '/usr/bin', '/var', '/var/log']) if (candidate.getNode(path)?.type !== 'dir') throw new Error(`Säkerhetskopians systemkatalog ${path} är ogiltig.`);
    if (candidate.storageError) throw new Error(candidate.storageError);
    this.state = candidate.state;
    if (!this.save()) throw new Error(this.storageError);
    return true;
  }
  save() {
    try { this.storage?.setItem('flinux-state', JSON.stringify(this.state)); if (this.storage) this.storageError = null; }
    catch { this.storageError = 'Kunde inte spara lokalt (lagringen kan vara full eller blockerad). Ändringarna finns kvar i den här sessionen.'; }
    for (const listener of this.listeners) { try { listener(this.state); } catch (error) { console.error('flinux: uppdatering misslyckades', error); } }
    return !this.storageError;
  }
  reset() { this.state = clone(DEFAULT_STATE); this.state.filesystem = sanitizeNode(this.state.filesystem); this.syncExecutables(); const saved = this.save(); if (saved) this.reload(); return saved; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  normalize(path, cwd = this.state.cwd) {
    path = String(path ?? ''); if (path.includes('\0')) throw new Error('Sökvägen innehåller ett ogiltigt tecken');
    path = path.replace(/\$HOME\b/g, this.state.user.home).replace(/^~(?=\/|$)/, this.state.user.home);
    const clean = [];
    for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
      if (!part || part === '.') continue; if (part === '..') clean.pop(); else clean.push(part);
    }
    return '/' + clean.join('/');
  }
  getNode(path) {
    let node = this.state.filesystem;
    for (const part of this.normalize(path).split('/').filter(Boolean)) {
      if (node?.type !== 'dir' || !own(node.children, part)) return null; node = node.children[part];
    }
    return node || null;
  }
  parent(path) { const parts = this.normalize(path).split('/').filter(Boolean), name = parts.pop(); return { node: this.getNode('/' + parts.join('/')), name }; }
  list(path = this.state.cwd) {
    const node = this.getNode(path); if (!node) throw new Error(`Kan inte komma åt '${path}': Filen eller katalogen finns inte`);
    if (node.type !== 'dir') return [this.normalize(path).split('/').pop()];
    return Object.keys(node.children).sort((a, b) => (node.children[b].type === 'dir') - (node.children[a].type === 'dir') || a.localeCompare(b));
  }
  assertParent(path) {
    const parent = this.parent(path); if (!parent.name) throw new Error('Åtgärden är inte tillåten på rotkatalogen');
    if (parent.node?.type !== 'dir') throw new Error('Överordnad katalog finns inte'); return parent;
  }
  mkdir(path) {
    const { node, name } = this.assertParent(path); if (own(node.children, name)) throw new Error(`mkdir: '${name}' finns redan`);
    node.children[name] = { type: 'dir', children: Object.create(null), mode: '755', modified: this.now(), owner: this.state.user.name, group: this.state.user.name }; this.save();
  }
  writeFile(path, content, append = false) {
    const normalized = this.normalize(path), { node, name } = this.assertParent(normalized), previous = own(node.children, name) ? node.children[name] : null;
    if (previous?.type === 'dir') throw new Error('Sökvägen är en katalog');
    node.children[name] = { type: 'file', content: (append ? previous?.content || '' : '') + String(content), mode: previous?.mode || '644', modified: this.now(), owner: previous?.owner || this.state.user.name, group: previous?.group || this.state.user.name };
    this.save(); return normalized;
  }
  protectedPath(path) { return ['/', '/home', this.state.user.home, '/usr', '/usr/bin', '/etc', '/var', '/var/log'].includes(path); }
  remove(path) {
    const normalized = this.normalize(path); if (this.protectedPath(normalized)) throw new Error('Åtgärden är inte tillåten på en skyddad systemkatalog');
    const { node, name } = this.assertParent(normalized); if (!own(node.children, name)) throw new Error('Filen eller katalogen finns inte');
    delete node.children[name]; this.save();
  }
  transfer(source, destination, move = false) {
    const sourcePath = this.normalize(source), sourceNode = this.getNode(sourcePath);
    if (!sourceNode) throw new Error(`Filen eller katalogen '${source}' finns inte`);
    if (this.protectedPath(sourcePath) && move) throw new Error('Kan inte flytta en skyddad systemkatalog');
    let target = this.normalize(destination); if (target === sourcePath) throw new Error('Källa och mål är samma fil');
    if (this.getNode(target)?.type === 'dir') target = this.normalize(`${target}/${sourcePath.split('/').pop()}`);
    if (target === sourcePath) throw new Error('Källa och mål är samma fil');
    if (sourceNode.type === 'dir' && (sourcePath === '/' || target.startsWith(sourcePath + '/'))) throw new Error('En katalog kan inte kopieras eller flyttas in i sig själv');
    const { node, name } = this.assertParent(target), existing = this.getNode(target);
    if (existing?.type === 'dir' || (existing && sourceNode.type === 'dir')) throw new Error('Målet finns redan och är inte en ersättningsbar fil');
    node.children[name] = sanitizeNode(sourceNode);
    if (move) { const parent = this.parent(sourcePath); delete parent.node.children[parent.name]; }
    this.save(); return target;
  }
  copy(source, destination) { return this.transfer(source, destination); }
  move(source, destination) { return this.transfer(source, destination, true); }
  chmod(path, mode) {
    if (!/^[0-7]{3}$/.test(mode)) throw new Error('chmod: använd en oktal rättighet, exempelvis 644 eller 755');
    const node = this.getNode(path); if (!node) throw new Error('Filen finns inte'); node.mode = mode; node.modified = this.now(); this.save();
  }
  filesystemStats(path = '/') {
    const root = this.getNode(path); if (!root) throw new Error('Sökvägen finns inte'); const stats = { files: 0, directories: 0, bytes: 0 };
    const walk = node => { if (node.type === 'file') { stats.files++; stats.bytes += new TextEncoder().encode(node.content).length; } else { stats.directories++; Object.values(node.children).forEach(walk); } };
    walk(root); return stats;
  }
  installDependencies(name, seen = new Set()) {
    if (seen.has(name)) throw new Error('Cirkulärt paketberoende'); seen.add(name);
    for (const dependency of PACKAGE_REGISTRY[name]?.dependencies || []) { this.installDependencies(dependency, new Set(seen)); if (!this.state.installed.includes(dependency)) this.state.installed.push(dependency); }
  }
  syncExecutables() {
    const bin = this.getNode('/usr/bin'); if (bin?.type !== 'dir') return;
    for (const name of this.state.installed) bin.children[PACKAGE_REGISTRY[name].command || name] = { ...file(`# flinux-paket: ${name}\n# Virtuellt program; körs av flinux, inte av värddatorn.\n`), mode: '755' };
  }
  logPackage(message) {
    this.state.packageLog.push(`${new Date(this.now()).toISOString()} ${message}`); this.state.packageLog = this.state.packageLog.slice(-100);
    const log = this.getNode('/var/log/apt.log'); if (log?.type === 'file') log.content = this.state.packageLog.join('\n') + '\n';
  }
  install(name) {
    if (!own(PACKAGE_REGISTRY, name)) throw new Error(`E: Paketet '${name}' har ingen installationskandidat.`);
    const pkg = PACKAGE_REGISTRY[name]; if (this.state.installed.includes(name)) return `${name} är redan installerat (${pkg.version}).`;
    const before = new Set(this.state.installed); this.installDependencies(name); this.state.installed.push(name); const added = this.state.installed.filter(n => !before.has(n));
    for (const installed of added) if (PACKAGE_REGISTRY[installed].service) this.state.services[installed] = { active: false, enabled: false, since: null };
    this.syncExecutables(); this.logPackage(`Installerade ${added.join(', ')}`); this.save();
    return `Installerade ${added.join(', ')} (${added.reduce((total, n) => total + PACKAGE_REGISTRY[n].size, 0)} kB).`;
  }
  uninstall(name) {
    if (!own(PACKAGE_REGISTRY, name)) throw new Error(`E: Kunde inte hitta paketet ${name}`); const pkg = PACKAGE_REGISTRY[name];
    if (pkg.core) throw new Error(`E: ${name} är ett skyddat systempaket.`);
    const dependent = this.state.installed.find(n => PACKAGE_REGISTRY[n].dependencies.includes(name)); if (dependent) throw new Error(`E: ${dependent} behöver ${name}. Ta bort ${dependent} först.`);
    if (!this.state.installed.includes(name)) return `${name} är inte installerat.`;
    this.state.installed = this.state.installed.filter(p => p !== name); const bin = this.getNode('/usr/bin'); if (bin?.type === 'dir') delete bin.children[pkg.command || name];
    delete this.state.services[name]; if (pkg.desktop === this.state.settings.desktop) this.state.settings.desktop = 'plasma';
    this.logPackage(`Tog bort ${name}`); this.save(); return `Tog bort ${name}.`;
  }
  getService(name) {
    name = String(name).replace(/\.service$/, '');
    if (!own(PACKAGE_REGISTRY, name) || !PACKAGE_REGISTRY[name].service || !this.state.installed.includes(name)) throw new Error(`Tjänsten ${name} finns inte. Installera dess paket först.`);
    return this.state.services[name] || { active: false, enabled: false, since: null };
  }
  setService(name, action) {
    name = String(name).replace(/\.service$/, ''); const service = { ...this.getService(name) };
    if (['start', 'restart'].includes(action)) { service.active = true; service.since = this.now(); }
    else if (action === 'stop') service.active = false; else if (action === 'enable') service.enabled = true; else if (action === 'disable') service.enabled = false; else throw new Error(`Okänd tjänståtgärd: ${action}`);
    this.state.services[name] = service; this.save(); return service;
  }
}

const system = new SystemCore();
export { system, SystemCore, DEFAULT_STATE, PACKAGE_REGISTRY };

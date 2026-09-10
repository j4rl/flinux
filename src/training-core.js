const clone = value => JSON.parse(JSON.stringify(value));

export const LAB_SCENARIOS = [
  {
    id: 'filesystem',
    title: '01 · Filer och kataloger',
    level: 'Grund',
    description: 'Skapa katalogen ~/lab och filen answer.txt i den. Filen ska innehålla ordet flinux.',
    hint: 'mkdir, cd, echo och > räcker.'
  },
  {
    id: 'permissions',
    title: '02 · Rättigheter på webbservern',
    level: 'Grund',
    description: 'Webbservern får 403 när den försöker läsa index.html. Ta reda på varför och rätta rättigheterna.',
    hint: 'Titta med ls -l och tänk på vilken användare Apache kör som.'
  },
  {
    id: 'users',
    title: '03 · Användare och sudo',
    level: 'Medel',
    description: 'Skapa användaren anna med hemkatalog och ge anna medlemskap i gruppen sudo.',
    hint: 'useradd och usermod -aG.'
  },
  {
    id: 'service',
    title: '04 · Tjänsten är nere',
    level: 'Medel',
    description: 'Apache är installerad men webbplatsen svarar inte. Få tjänsten aktiv och verifiera med curl.',
    hint: 'systemctl status, start/restart och curl.'
  },
  {
    id: 'dns',
    title: '05 · IP fungerar men namn gör det inte',
    level: 'Medel',
    description: 'server kan nås via 192.168.1.20 men inte via namn. Reparera DNS-konfigurationen.',
    hint: 'ip route, ping och /etc/resolv.conf.'
  }
];

const DEFAULT_USERS = {
  root: { name: 'root', uid: 0, gid: 0, home: '/root', shell: '/bin/flinux', groups: ['root'], system: true },
  jarl: { name: 'jarl', uid: 1000, gid: 1000, home: '/home/jarl', shell: '/bin/flinux', groups: ['jarl', 'sudo'] },
  'www-data': { name: 'www-data', uid: 33, gid: 33, home: '/var/www', shell: '/usr/sbin/nologin', groups: ['www-data'], system: true }
};

const DEFAULT_GROUPS = {
  root: { name: 'root', gid: 0, members: ['root'] },
  sudo: { name: 'sudo', gid: 27, members: ['jarl'] },
  jarl: { name: 'jarl', gid: 1000, members: ['jarl'] },
  'www-data': { name: 'www-data', gid: 33, members: ['www-data'] }
};

function ensureDir(system, path, mode = '755') {
  if (!system.getNode(path)) {
    system.mkdir(path);
    Object.assign(system.getNode(path), { mode, owner: 'root', group: 'root' });
  }
  return system.getNode(path);
}

function ensureFile(system, path, content = '', mode = '644') {
  if (!system.getNode(path)) {
    system.writeFile(path, content);
    Object.assign(system.getNode(path), { mode, owner: 'root', group: 'root' });
  }
  return system.getNode(path);
}

function defaultOwnerForPath(path) {
  if (path === '/home/jarl' || path.startsWith('/home/jarl/')) return ['jarl', 'jarl'];
  if (path === '/var/www' || path.startsWith('/var/www/')) return ['root', 'root'];
  return ['root', 'root'];
}

function walk(system, path, visit) {
  const node = system.getNode(path);
  if (!node) return;
  visit(node, path);
  if (node.type === 'dir') {
    for (const name of Object.keys(node.children)) walk(system, path === '/' ? '/' + name : path + '/' + name, visit);
  }
}

function syncAccountFiles(system, state) {
  const passwd = Object.values(state.users).sort((a, b) => a.uid - b.uid)
    .map(user => `${user.name}:x:${user.uid}:${user.gid}:${user.name}:${user.home}:${user.shell}`).join('\n') + '\n';
  const group = Object.values(state.groups).sort((a, b) => a.gid - b.gid)
    .map(entry => `${entry.name}:x:${entry.gid}:${entry.members.join(',')}`).join('\n') + '\n';
  const shadow = Object.values(state.users).sort((a, b) => a.uid - b.uid)
    .map(user => `${user.name}:!:20000:0:99999:7:::`).join('\n') + '\n';
  system.writeFile('/etc/passwd', passwd);
  system.writeFile('/etc/group', group);
  system.writeFile('/etc/shadow', shadow);
  for (const [path, mode] of [['/etc/passwd', '644'], ['/etc/group', '644'], ['/etc/shadow', '640']]) {
    const node = system.getNode(path); if (node) { node.owner = 'root'; node.group = 'root'; node.mode = mode; }
  }
}

function initialize(system) {
  const firstInitialization = !system.state.training || system.state.training.version !== 1;
  if (firstInitialization) {
    system.state.training = {
      version: 1,
      users: clone(DEFAULT_USERS),
      groups: clone(DEFAULT_GROUPS),
      nextUid: 1001,
      nextGid: 1001,
      processes: [],
      nextPid: 100,
      network: {
        interface: 'eth0',
        address: '192.168.1.10/24',
        gateway: '192.168.1.1',
        dns: '192.168.1.1',
        hosts: { router: '192.168.1.1', server: '192.168.1.20', nas: '192.168.1.30', flinux: '192.168.1.10' }
      },
      activeLab: null,
      labSnapshot: null
    };
  }
  const state = system.state.training;
  state.users ||= clone(DEFAULT_USERS);
  state.groups ||= clone(DEFAULT_GROUPS);
  state.processes ||= [];
  state.network ||= { interface: 'eth0', address: '192.168.1.10/24', gateway: '192.168.1.1', dns: '192.168.1.1', hosts: { router: '192.168.1.1', server: '192.168.1.20', nas: '192.168.1.30', flinux: '192.168.1.10' } };
  for (const [name, user] of Object.entries(DEFAULT_USERS)) state.users[name] ||= clone(user);
  for (const [name, group] of Object.entries(DEFAULT_GROUPS)) state.groups[name] ||= clone(group);

  ensureDir(system, '/root', '700');
  for (const path of ['/proc', '/dev', '/mnt', '/run', '/opt']) ensureDir(system, path);
  ensureFile(system, '/proc/cpuinfo', 'processor\t: 0\nmodel name\t: flinux Virtual CPU\ncpu cores\t: 2\n', '444');
  ensureFile(system, '/proc/meminfo', 'MemTotal:        2097152 kB\nMemFree:         1572864 kB\n', '444');
  ensureFile(system, '/etc/hostname', system.state.user.host + '\n');
  ensureFile(system, '/etc/hosts', '127.0.0.1 localhost\n192.168.1.10 flinux\n192.168.1.20 server\n192.168.1.30 nas\n');
  ensureFile(system, '/etc/resolv.conf', `nameserver ${state.network.dns || ''}\n`);
  const tmp = system.getNode('/tmp'); if (tmp && firstInitialization) tmp.mode = '777';

  walk(system, '/', (node, path) => {
    if (!node.owner || !node.group) {
      const [owner, group] = defaultOwnerForPath(path);
      node.owner ||= owner; node.group ||= group;
    }
  });
  syncAccountFiles(system, state);
  system.save();
  return state;
}

function modeDigit(node, user, groups) {
  const mode = node.mode || (node.type === 'dir' ? '755' : '644');
  if (node.owner === user) return Number(mode[0]);
  if (groups.includes(node.group)) return Number(mode[1]);
  return Number(mode[2]);
}

export function createTrainingCore(system) {
  initialize(system);
  // Imports replace system.state; existing terminals and lab windows must follow it.
  const getState = () => system.state.training || initialize(system);
  const userRecord = name => getState().users[name] || null;
  const groupsFor = name => {
    const state = getState();
    const user = userRecord(name); if (!user) return [];
    return [...new Set([...(user.groups || []), ...Object.values(state.groups).filter(g => g.members.includes(name)).map(g => g.name)])];
  };
  const requireUser = name => { const user = userRecord(name); if (!user) throw new Error(`${name}: användaren finns inte`); return user; };
  const requireRoot = (name, action = 'åtgärden') => { if (name !== 'root') throw new Error(`${action}: Permission denied — kräver root/sudo`); };

  function can(path, username, permission) {
    const node = system.getNode(path); if (!node) return false;
    if (username === 'root') return true;
    const digit = modeDigit(node, username, groupsFor(username));
    const bit = permission === 'read' ? 4 : permission === 'write' ? 2 : 1;
    return Boolean(digit & bit);
  }
  function assertTraverse(path, username) {
    const normalized = system.normalize(path);
    if (!can('/', username, 'execute')) throw new Error(`${path}: Permission denied`);
    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (const part of parts.slice(0, -1)) {
      current += '/' + part;
      const node = system.getNode(current);
      if (node?.type === 'dir' && !can(current, username, 'execute')) throw new Error(`${path}: Permission denied`);
    }
  }
  function read(path, username) {
    const normalized = system.normalize(path); assertTraverse(normalized, username);
    const node = system.getNode(normalized);
    if (!node) throw new Error(`${path}: Filen eller katalogen finns inte`);
    if (node.type !== 'file') throw new Error(`${path}: Är en katalog`);
    if (!can(normalized, username, 'read')) throw new Error(`${path}: Permission denied`);
    return node.content;
  }
  function parentWritable(path, username) {
    const normalized = system.normalize(path), parentPath = normalized.slice(0, normalized.lastIndexOf('/')) || '/';
    assertTraverse(normalized, username);
    if (!can(parentPath, username, 'write') || !can(parentPath, username, 'execute')) throw new Error(`${path}: Permission denied`);
  }
  function writeFile(path, content, append, username, mode = null) {
    const normalized = system.normalize(path), previous = system.getNode(normalized);
    if (previous) {
      assertTraverse(normalized, username);
      if (!can(normalized, username, 'write')) throw new Error(`${path}: Permission denied`);
    } else parentWritable(normalized, username);
    system.writeFile(normalized, content, append);
    const node = system.getNode(normalized);
    if (!previous && node) {
      node.owner = username; node.group = groupsFor(username).find(g => g !== 'sudo') || username;
      if (mode) node.mode = mode;
      system.save();
    }
    return normalized;
  }
  function mkdir(path, username, mode = '755') {
    const normalized = system.normalize(path); parentWritable(normalized, username);
    system.mkdir(normalized);
    const node = system.getNode(normalized); if (node) { node.owner = username; node.group = groupsFor(username).find(g => g !== 'sudo') || username; node.mode = mode; system.save(); }
  }
  function remove(path, username) {
    const normalized = system.normalize(path); parentWritable(normalized, username); system.remove(normalized);
  }
  function copy(source, destination, username, move = false) {
    const sourcePath = system.normalize(source); assertTraverse(sourcePath, username);
    const sourceNode = system.getNode(sourcePath);
    if (!sourceNode) throw new Error(`${source}: Filen eller katalogen finns inte`);
    let target = system.normalize(destination);
    if (system.getNode(target)?.type === 'dir') target = system.normalize(target + '/' + sourcePath.split('/').pop());
    if (move) {
      parentWritable(sourcePath, username);
      parentWritable(target, username);
      return system.move(sourcePath, destination);
    }
    walk(system, sourcePath, (node, path) => {
      assertTraverse(path, username);
      if (!can(path, username, 'read') || (node.type === 'dir' && !can(path, username, 'execute'))) throw new Error(`${path}: Permission denied`);
    });
    const existing = system.getNode(target);
    if (existing) {
      assertTraverse(target, username);
      if (!can(target, username, 'write')) throw new Error(`${target}: Permission denied`);
    } else parentWritable(target, username);
    const copied = system.copy(sourcePath, destination);
    walk(system, copied, node => {
      node.owner = username;
      node.group = groupsFor(username).find(group => group !== 'sudo') || username;
    });
    if (existing) Object.assign(system.getNode(copied), { owner: existing.owner, group: existing.group, mode: existing.mode });
    system.save();
    return copied;
  }
  function chmod(path, mode, username) {
    const normalized = system.normalize(path), node = system.getNode(normalized);
    assertTraverse(normalized, username);
    if (!node) throw new Error('chmod: Filen finns inte');
    if (username !== 'root' && node.owner !== username) throw new Error('chmod: Operation not permitted');
    system.chmod(normalized, mode);
  }
  function chown(path, owner, group, username) {
    const state = getState();
    requireRoot(username, 'chown');
    requireUser(owner);
    if (group && !state.groups[group]) throw new Error(`chown: gruppen '${group}' finns inte`);
    const node = system.getNode(path); if (!node) throw new Error('chown: Filen finns inte');
    node.owner = owner; if (group) node.group = group; node.modified = system.now(); system.save();
  }
  function chgrp(path, group, username) {
    const state = getState();
    assertTraverse(path, username);
    if (!state.groups[group]) throw new Error(`chgrp: gruppen '${group}' finns inte`);
    const node = system.getNode(path); if (!node) throw new Error('chgrp: Filen finns inte');
    if (username !== 'root' && (node.owner !== username || !groupsFor(username).includes(group))) throw new Error('chgrp: Operation not permitted');
    node.group = group; node.modified = system.now(); system.save();
  }

  function addUser(name, { sudo = false, createHome = true } = {}) {
    const state = getState();
    if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(name)) throw new Error('useradd: ogiltigt användarnamn');
    if (state.users[name]) throw new Error(`useradd: användaren '${name}' finns redan`);
    const uid = state.nextUid++, gid = state.nextGid++;
    state.groups[name] = { name, gid, members: [name] };
    state.users[name] = { name, uid, gid, home: '/home/' + name, shell: '/bin/flinux', groups: [name] };
    if (sudo) addToGroup(name, 'sudo');
    if (createHome) {
      ensureDir(system, '/home');
      if (!system.getNode('/home/' + name)) system.mkdir('/home/' + name);
      const home = system.getNode('/home/' + name); home.owner = name; home.group = name; home.mode = '755';
      system.writeFile('/home/' + name + '/.bashrc', `export USER=${name}\nexport HOME=/home/${name}\nexport SHELL=/bin/flinux\n`);
      const bashrc = system.getNode('/home/' + name + '/.bashrc'); bashrc.owner = name; bashrc.group = name;
    }
    syncAccountFiles(system, state); system.save(); return state.users[name];
  }
  function deleteUser(name, removeHome = false) {
    const state = getState();
    if (['root', 'jarl', 'www-data'].includes(name)) throw new Error('userdel: den användaren är skyddad');
    requireUser(name);
    for (const group of Object.values(state.groups)) group.members = group.members.filter(member => member !== name);
    delete state.groups[name]; delete state.users[name];
    if (removeHome && system.getNode('/home/' + name)) system.remove('/home/' + name);
    syncAccountFiles(system, state); system.save();
  }
  function addToGroup(name, group) {
    const state = getState();
    const user = requireUser(name); const target = state.groups[group]; if (!target) throw new Error(`usermod: gruppen '${group}' finns inte`);
    if (!target.members.includes(name)) target.members.push(name);
    if (!user.groups.includes(group)) user.groups.push(group);
    syncAccountFiles(system, state); system.save();
  }
  function isSudoer(name) { return name === 'root' || groupsFor(name).includes('sudo'); }
  function idText(name) {
    const state = getState();
    const user = requireUser(name), groupNames = groupsFor(name);
    const primary = Object.values(state.groups).find(group => group.gid === user.gid)?.name || name;
    const groupText = groupNames.map(groupName => {
      const group = state.groups[groupName]; return group ? `${group.gid}(${group.name})` : groupName;
    }).join(',');
    return `uid=${user.uid}(${user.name}) gid=${user.gid}(${primary}) groups=${groupText}`;
  }

  function listProcesses() {
    const state = getState();
    const base = [
      { pid: 1, ppid: 0, user: 'root', state: 'S', command: 'flinux-core' },
      { pid: 12, ppid: 1, user: 'jarl', state: 'S', command: system.state.settings.desktop + '-desktop' }
    ];
    const services = Object.entries(system.state.services || {}).filter(([, service]) => service?.active).map(([name], index) => ({
      pid: 40 + index, ppid: 1, user: name === 'apache2' ? 'www-data' : 'root', state: 'S', command: name
    }));
    return [...base, ...services, ...state.processes];
  }
  function spawnProcess(command, user = 'jarl') {
    const state = getState();
    const process = { pid: state.nextPid++, ppid: 1, user, state: 'S', command: String(command).slice(0, 120) };
    state.processes.push(process); system.save(); return process;
  }
  function kill(pid, username) {
    const state = getState();
    pid = Number(pid);
    const process = listProcesses().find(entry => entry.pid === pid); if (!process) throw new Error(`kill: (${pid}) - No such process`);
    if (pid <= 40) throw new Error('kill: den processen hanteras av systemet/tjänstehanteraren');
    if (username !== 'root' && process.user !== username) throw new Error('kill: Operation not permitted');
    state.processes = state.processes.filter(entry => entry.pid !== pid); system.save();
  }

  function resolveHost(host) {
    const state = getState();
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return host;
    if (!state.network.dns) return null;
    return state.network.hosts[host] || null;
  }
  function setDns(value) {
    const state = getState();
    state.network.dns = value;
    system.writeFile('/etc/resolv.conf', value ? `nameserver ${value}\n` : '');
    const node = system.getNode('/etc/resolv.conf'); if (node) { node.owner = 'root'; node.group = 'root'; node.mode = '644'; }
    system.save();
  }
  function dnsFromFile() {
    const node = system.getNode('/etc/resolv.conf');
    const match = node?.type === 'file' ? node.content.match(/^\s*nameserver\s+(\S+)/m) : null;
    return match?.[1] || '';
  }
  function syncDnsFromFile() {
    const state = getState();
    const dns = dnsFromFile();
    if (state.network.dns !== dns) {
      state.network.dns = dns;
      system.save();
    }
  }
  function ipAddressText() {
    const state = getState();
    return `1: lo: <LOOPBACK,UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: ${state.network.interface}: <BROADCAST,MULTICAST,UP> mtu 1500\n    inet ${state.network.address} brd 192.168.1.255 scope global ${state.network.interface}\n`;
  }
  function routeText() { const state = getState(); return `default via ${state.network.gateway} dev ${state.network.interface}\n192.168.1.0/24 dev ${state.network.interface} proto kernel scope link src ${state.network.address.split('/')[0]}\n`; }
  function socketText() {
    const rows = ['Netid State  Local Address:Port  Process'];
    if (system.state.services?.apache2?.active) rows.push('tcp   LISTEN 0.0.0.0:80          apache2');
    return rows.join('\n') + '\n';
  }

  function snapshotState() {
    const copy = clone(system.state);
    if (copy.training) copy.training.labSnapshot = null;
    return JSON.stringify(copy);
  }
  function startLab(id) {
    const state = getState();
    const scenario = LAB_SCENARIOS.find(item => item.id === id); if (!scenario) throw new Error('Okänd labb');
    if (!state.labSnapshot) state.labSnapshot = snapshotState();
    state.activeLab = id;
    if (id === 'filesystem') {
      if (system.getNode('/home/jarl/lab')) system.remove('/home/jarl/lab');
    } else if (id === 'permissions') {
      if (!system.state.installed.includes('apache2')) system.install('apache2');
      system.setService('apache2', 'start');
      const node = system.getNode('/var/www/html/index.html'); node.owner = 'root'; node.group = 'root'; node.mode = '600';
    } else if (id === 'users') {
      if (state.users.anna) deleteUser('anna', true);
    } else if (id === 'service') {
      if (!system.state.installed.includes('apache2')) system.install('apache2');
      system.setService('apache2', 'stop');
    } else if (id === 'dns') {
      setDns('');
    }
    system.save();
    return scenario;
  }
  function checkLab() {
    const state = getState();
    const id = state.activeLab; if (!id) return { ok: false, message: 'Ingen labb är startad.' };
    let ok = false, detail = '';
    if (id === 'filesystem') {
      const node = system.getNode('/home/jarl/lab/answer.txt');
      ok = node?.type === 'file' && /flinux/i.test(node.content); detail = ok ? 'Katalog och fil är korrekta.' : 'Kontrollerar ~/lab/answer.txt och dess innehåll.';
    } else if (id === 'permissions') {
      try { read('/var/www/html/index.html', 'www-data'); ok = true; } catch { ok = false; }
      detail = ok ? 'www-data kan nu läsa index.html.' : 'www-data behöver läsrättighet till index.html och åtkomst genom dess kataloger.';
    } else if (id === 'users') {
      ok = Boolean(state.users.anna && groupsFor('anna').includes('sudo') && system.getNode('/home/anna')); detail = ok ? 'anna finns, har hemkatalog och sudo.' : 'Kontrollerar användaren anna, /home/anna och gruppen sudo.';
    } else if (id === 'service') {
      ok = Boolean(system.state.services?.apache2?.active); detail = ok ? 'apache2 är active (running).' : 'apache2 är fortfarande inte aktiv.';
    } else if (id === 'dns') {
      const dns = dnsFromFile(); ok = Boolean(dns); detail = ok ? `DNS är konfigurerad till ${dns}.` : 'Ingen nameserver hittades i /etc/resolv.conf.';
    }
    return { ok, message: detail };
  }
  function resetLab() {
    const state = getState();
    if (!state.labSnapshot) return false;
    const restored = JSON.parse(state.labSnapshot);
    restored.training.labSnapshot = null;
    restored.training.activeLab = null;
    const restoredTraining = restored.training;
    delete restored.training;
    for (const key of Object.keys(system.state)) if (key !== 'training') delete system.state[key];
    Object.assign(system.state, restored);
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, restoredTraining);
    system.state.training = state;
    system.save();
    return true;
  }

  return {
    get state() { return getState(); },
    labs: LAB_SCENARIOS,
    user: userRecord,
    groupsFor,
    isSudoer,
    requireRoot,
    idText,
    addUser,
    deleteUser,
    addToGroup,
    can,
    assertTraverse,
    parentWritable,
    read,
    writeFile,
    mkdir,
    remove,
    copy: (source, destination, username) => copy(source, destination, username, false),
    move: (source, destination, username) => copy(source, destination, username, true),
    chmod,
    chown,
    chgrp,
    listProcesses,
    spawnProcess,
    kill,
    resolveHost,
    setDns,
    syncDnsFromFile,
    ipAddressText,
    routeText,
    socketText,
    startLab,
    checkLab,
    resetLab
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemCore, DEFAULT_STATE, PACKAGE_REGISTRY } from '../src/system.js';
import { createShellSession, tokenizeShell } from '../src/terminal.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function setup(options = {}) {
  const storage = options.storage || memoryStorage();
  const system = new SystemCore({ storage, now: () => 1770000000000, reload: () => {} });
  const opened = [];
  const shell = createShellSession({ system, openApp: (...args) => opened.push(args) });
  return { system, shell, storage, opened };
}
function ok(shell, command) {
  const response = shell.execute(command);
  assert.equal(response.code, 0, command + ': ' + response.stderr);
  assert.equal(response.stderr, '', command);
  return response.stdout;
}

test('new system shares branding and starter files and packages', () => {
  const { system } = setup();
  assert.equal(system.state.user.host, 'flinux');
  assert.equal(system.state.settings.desktop, 'plasma');
  assert.match(system.getNode('/etc/os-release').content, /1.0 Glimten/);
  assert.match(system.getNode('Pictures/Glimten.svg').content, /flinux-wallpaper:glimten/);
  assert.ok(Object.keys(PACKAGE_REGISTRY).length >= 30);
  for (const name of system.state.installed) assert.ok(PACKAGE_REGISTRY[name]);
});

test('copy and move reject self destinations without deleting or changing files', () => {
  const { system } = setup();
  system.writeFile('keep.txt', 'precious');
  assert.throws(() => system.move('keep.txt', 'keep.txt'), /samma/);
  assert.throws(() => system.move('keep.txt', '.'), /samma/);
  assert.throws(() => system.copy('keep.txt', 'keep.txt'), /samma/);
  assert.equal(system.getNode('keep.txt').content, 'precious');
  system.mkdir('folder'); system.writeFile('folder/a', 'nested');
  assert.throws(() => system.move('folder', 'folder/deeper'), /sig själv/);
  assert.throws(() => system.copy('folder', 'folder/deeper'), /sig själv/);
  assert.equal(system.getNode('folder/a').content, 'nested');
});

test('failed move is atomic and copies are independent', () => {
  const { system } = setup();
  system.writeFile('a', 'original');
  assert.throws(() => system.move('a', '/does/not/exist'));
  assert.equal(system.getNode('a').content, 'original');
  system.copy('a', 'b'); system.writeFile('b', 'changed');
  assert.equal(system.getNode('a').content, 'original');
  system.move('b', 'c'); assert.equal(system.getNode('b'), null); assert.equal(system.getNode('c').content, 'changed');
});

test('prototype names behave as plain filenames, including after reload', () => {
  const { system, storage } = setup();
  assert.equal(system.getNode('constructor'), null);
  for (const name of ['__proto__', 'constructor', 'toString']) system.writeFile(name, 'safe-' + name);
  const reloaded = new SystemCore({ storage });
  for (const name of ['__proto__', 'constructor', 'toString']) assert.equal(reloaded.getNode(name).content, 'safe-' + name);
  assert.equal({}.content, undefined);
  assert.throws(() => system.install('__proto__'), /installationskandidat/);
  assert.throws(() => system.install('constructor'), /installationskandidat/);
});

test('legacy migration preserves user content and legacy storage untouched', () => {
  const legacy = structuredClone(DEFAULT_STATE);
  delete legacy.schemaVersion; legacy.user.host = 'jarlix'; legacy.settings = { desktop: 'gnome' }; legacy.installed = ['kate'];
  legacy.filesystem.children.home.children.jarl.children.Documents.children['mitt.txt'] = { type: 'file', content: 'mitt arbete' };
  const serialized = JSON.stringify(legacy), storage = memoryStorage({ 'jarlix-state': serialized });
  const system = new SystemCore({ storage });
  assert.equal(system.migratedFromLegacy, true);
  assert.equal(storage.getItem('jarlix-state'), serialized);
  assert.equal(system.state.user.host, 'flinux');
  assert.equal(system.getNode('Documents/mitt.txt').content, 'mitt arbete');
  assert.equal(system.state.settings.desktop, 'gnome');
  assert.ok(system.state.installed.includes('gnome-shell'));
  assert.equal(JSON.parse(storage.getItem('flinux-state')).schemaVersion, 2);
});

test('ordinary reload does not restore deleted starter documents', () => {
  const { system, storage } = setup();
  system.remove('Documents/välkommen.txt'); system.remove('Pictures/Glimten.svg');
  const reloaded = new SystemCore({ storage });
  assert.equal(reloaded.getNode('Documents/välkommen.txt'), null);
  assert.equal(reloaded.getNode('Pictures/Glimten.svg'), null);
});

test('storage failures preserve session changes and notify subscribers', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const system = new SystemCore({ storage }); let changes = 0; system.onChange(() => changes++);
  system.writeFile('a', 'still here');
  assert.equal(system.getNode('a').content, 'still here');
  assert.equal(changes, 1); assert.match(system.storageError, /Kunde inte spara/);
});

test('import validates before replacing state and round trips settings and files', () => {
  const { system } = setup(); system.writeFile('precious', 'save me');
  const before = JSON.stringify(system.state);
  assert.throws(() => system.importState({ filesystem: { type: 'dir', children: { bad: null } }, installed: [] }));
  assert.equal(JSON.stringify(system.state), before);
  assert.throws(() => system.importState({ ...system.state, schemaVersion: 999 }));
  assert.equal(JSON.stringify(system.state), before);
  const replacement = structuredClone(system.state); replacement.settings.desktop = 'i3'; replacement.installed.push('i3-wm'); replacement.filesystem.children.home.children.jarl.children.precious.content = 'new content';
  system.importState(replacement);
  assert.equal(system.getNode('precious').content, 'new content'); assert.equal(system.state.settings.desktop, 'i3');
});

test('package dependencies, protected packages and desktop fallback', () => {
  const { system } = setup(); system.uninstall('kate'); system.install('nano');
  assert.ok(system.state.installed.includes('kate'));
  assert.throws(() => system.uninstall('kate'), /nano behöver kate/);
  assert.throws(() => system.uninstall('coreutils'), /skyddat/);
  system.install('i3-wm'); system.state.settings.desktop = 'i3'; system.uninstall('i3-wm');
  assert.equal(system.state.settings.desktop, 'plasma');
  assert.match(system.getNode('/var/log/apt.log').content, /Installerade kate, nano/);
});

test('failed persistence prevents reload on reset and reports import failure', () => {
  let reloads = 0;
  const system = new SystemCore({ storage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } }, reload: () => reloads++ });
  const backup = structuredClone(system.state);
  backup.filesystem.children.home.children.jarl.children['imported.txt'] = { type: 'file', content: 'recoverable in this session' };
  assert.throws(() => system.importState(backup), /Kunde inte spara/);
  assert.equal(system.getNode('imported.txt').content, 'recoverable in this session');
  assert.equal(reloads, 0);
  assert.equal(system.reset(), false);
  assert.equal(reloads, 0);
});

test('shell preserves quotes, operators in text and escaped spaces', () => {
  const { shell, system } = setup();
  assert.equal(ok(shell, `echo 'a | b > c && d'`), 'a | b > c && d\n');
  ok(shell, `echo "Det glada linuxet" > "min fil.txt"`);
  assert.equal(system.getNode('min fil.txt').content, 'Det glada linuxet\n');
  assert.equal(ok(shell, 'cat min\\ fil.txt'), 'Det glada linuxet\n');
  assert.equal(ok(shell, "echo '' x"), ' x\n');
  assert.equal(shell.execute('echo "unfinished').code, 2);
  assert.equal(shell.execute('echo hello |').code, 2);
  assert.equal(tokenizeShell(`echo '$HOME' "$HOME"`, { HOME: '/home/jarl' })[1].value, '$HOME');
});

test('pipelines, redirects, appending and input redirection preserve content', () => {
  const { shell, system } = setup();
  ok(shell, `printf 'pear\\napple\\npear\\n' | sort | uniq > fruit.txt`);
  assert.equal(system.getNode('fruit.txt').content, 'apple\npear\n');
  ok(shell, 'echo plum >> fruit.txt');
  assert.equal(ok(shell, 'cat < fruit.txt | grep p | wc -l'), '3\n');
  assert.equal(ok(shell, 'tail -n 1 fruit.txt'), 'plum\n');
  assert.equal(ok(shell, 'tail -n 0 fruit.txt'), '');
});

test('conditional command lists respect error status and short circuit', () => {
  const { shell } = setup();
  assert.equal(ok(shell, 'false && echo bad || echo recovered; echo done'), 'recovered\ndone\n');
  assert.equal(ok(shell, 'true || echo bad && echo good'), 'good\n');
  const failed = shell.execute('cat missing && touch should-not-exist');
  assert.equal(failed.code, 1); assert.match(failed.stderr, /finns inte/);
  assert.equal(ok(shell, 'echo $?'), '1\n');
});

test('working directories and variables are per terminal and expand at execution', () => {
  const { shell, system } = setup(), other = createShellSession({ system });
  assert.equal(ok(shell, 'cd Documents; pwd'), '/home/jarl/Documents\n');
  assert.equal(other.cwd, '/home/jarl'); assert.equal(system.state.cwd, '/home/jarl');
  assert.equal(ok(shell, 'cd ..; echo $PWD'), '/home/jarl\n');
  assert.equal(ok(shell, `export GREETING='hej flinux'; echo "$GREETING"`), 'hej flinux\n');
  assert.equal(ok(other, 'echo "$GREETING"'), '\n');
  assert.equal(ok(shell, 'false; echo $?'), '1\n');
});

test('completion follows installed packages and current directory', () => {
  const { shell } = setup();
  assert.equal(shell.complete('neo').value, 'neofetch ');
  assert.deepEqual(shell.complete('cows').matches, []);
  ok(shell, 'apt install cowsay'); assert.equal(shell.complete('cows').value, 'cowsay ');
  assert.equal(shell.complete('cd Doc').value, 'cd Documents/');
  ok(shell, 'cd Documents'); assert.ok(shell.complete('cat väl').value.startsWith('cat välkommen.txt'));
});

test('optional text packages process real pipeline input', () => {
  const { shell } = setup();
  ok(shell, 'apt install sed jq base64 diffutils figlet cal');
  assert.equal(ok(shell, `printf 'hej hej\\n' | sed 's/hej/flinux/g'`), 'flinux flinux\n');
  assert.equal(ok(shell, `echo '{"desktop":{"name":"Plasma"}}' | jq -r .desktop.name`), 'Plasma\n');
  assert.equal(ok(shell, `echo -n 'räksmörgås' | base64 | base64 -d`), 'räksmörgås');
  assert.match(ok(shell, 'figlet FLINUX'), /█/);
  assert.match(ok(shell, 'cal 2 2024'), /29/);
  assert.equal(ok(shell, `echo 'alice:42:admin' | cut -d ':' -f 1,3`), 'alice:admin\n');
  assert.equal(ok(shell, `echo 'flinux' | tr a-z A-Z`), 'FLINUX\n');
});

test('Apache lifecycle controls virtual curl and wget, persists and removes cleanly', () => {
  const { shell, system, storage } = setup();
  ok(shell, 'apt install apache2 wget');
  assert.equal(system.state.services.apache2.active, false);
  assert.equal(shell.execute('curl localhost').code, 1);
  ok(shell, 'systemctl start apache2');
  assert.match(ok(shell, 'curl http://localhost/'), /Det glada linuxet/);
  ok(shell, 'wget -O server.html http://flinux.local/');
  assert.match(system.getNode('server.html').content, /virtuella Apache/);
  ok(shell, 'systemctl enable apache2');
  assert.equal(new SystemCore({ storage }).getService('apache2').enabled, true);
  ok(shell, 'systemctl stop apache2'); assert.equal(shell.execute('curl localhost').code, 1);
  ok(shell, 'apt remove apache2'); assert.equal(system.state.services.apache2, undefined);
});

test('archive round trips directories and blocks traversal before writing anything', () => {
  const { shell, system } = setup();
  ok(shell, 'apt install flinux-archive');
  ok(shell, 'mkdir -p source/sub out; echo hello > source/sub/file.txt');
  ok(shell, 'archive create backup.flar source; archive extract backup.flar out');
  assert.equal(system.getNode('out/source/sub/file.txt').content, 'hello\n');
  assert.equal(shell.execute('archive extract backup.flar out').code, 1);
  system.writeFile('evil.flar', JSON.stringify({ format: 'flinux-archive-1', entries: [{ path: 'safe.txt', type: 'file', content: 'would write' }, { path: '../escape.txt', type: 'file', content: 'bad' }] }));
  assert.equal(shell.execute('archive extract evil.flar out').code, 1);
  assert.equal(system.getNode('out/safe.txt'), null); assert.equal(system.getNode('escape.txt'), null);
});

test('terminal applications launch through the same installed package registry', () => {
  const { shell, opened } = setup();
  assert.equal(shell.execute('snake').code, 1);
  ok(shell, 'apt install snake kcalc nano'); ok(shell, 'snake'); ok(shell, 'kcalc'); ok(shell, 'nano notes.txt');
  assert.deepEqual(opened.map(args => args[0]), ['snake', 'calculator', 'kate']);
  assert.equal(opened[2][1].path, '/home/jarl/notes.txt');
});

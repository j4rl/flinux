import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemCore } from '../src/system.js';
import { createShellSession } from '../src/terminal.js';

function setup() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const system = new SystemCore({ storage });
  const shell = createShellSession({ system });
  return { system, shell, storage };
}

function ok(shell, command) {
  const response = shell.execute(command);
  assert.equal(response.code, 0, command + ': ' + response.stderr);
  return response.stdout;
}

function denied(shell, command) {
  const response = shell.execute(command);
  assert.equal(response.code, 1, command);
  assert.match(response.stderr, /Permission denied/, command);
}

test('directory commands and completion respect private ancestors', () => {
  const { system, shell } = setup();
  system.mkdir('/root/private');
  system.mkdir('/root/private/empty');
  system.writeFile('/root/private/secret.txt', 'private');
  for (const command of ['cd /root', 'ls /root/private', 'ls -l /root/private', 'tree /root', 'find /root', 'rmdir /root/private/empty']) denied(shell, command);
  assert.equal(shell.cwd, '/home/jarl');
  assert.equal(system.getNode('/root/private/empty').type, 'dir');
  assert.deepEqual(shell.complete('cat /root/private/se').matches, []);
  assert.match(ok(shell, 'sudo ls /root/private'), /secret.txt/);
});

test('wget and archive use the same permissions as ordinary file commands', () => {
  const { system, shell } = setup();
  ok(shell, 'apt install wget flinux-archive');
  system.writeFile('source.txt', 'public');
  denied(shell, 'wget -O /etc/download.txt file:///home/jarl/source.txt');
  assert.equal(system.getNode('/etc/download.txt'), null);
  denied(shell, 'archive create shadow.flar /etc/shadow');
  assert.equal(system.getNode('shadow.flar'), null);
  denied(shell, 'archive create /etc/backup.flar source.txt');
  assert.equal(system.getNode('/etc/backup.flar'), null);
  ok(shell, 'archive create backup.flar source.txt');
  denied(shell, 'archive extract backup.flar /root');
  assert.equal(system.getNode('/root/source.txt'), null);
});

test('archive extraction checks all existing parents before creating files', () => {
  const { system, shell } = setup();
  ok(shell, 'apt install flinux-archive');
  ok(shell, 'mkdir -p out/locked; chmod 555 out/locked');
  system.writeFile('blocked.flar', JSON.stringify({ format: 'flinux-archive-1', entries: [
    { path: 'safe.txt', type: 'file', content: 'must not appear' },
    { path: 'locked/denied.txt', type: 'file', content: 'denied' }
  ] }));
  denied(shell, 'archive extract blocked.flar out');
  assert.equal(system.getNode('out/safe.txt'), null);
  assert.equal(system.getNode('out/locked/denied.txt'), null);
});

test('archive extraction restores restrictive modes after creating descendants', () => {
  const { system, shell } = setup();
  ok(shell, 'apt install flinux-archive');
  system.writeFile('readonly.flar', JSON.stringify({ format: 'flinux-archive-1', entries: [
    { path: 'readonly', type: 'dir', mode: '500' },
    { path: 'readonly/nested', type: 'dir', mode: '500' },
    { path: 'readonly/nested/keep.txt', type: 'file', mode: '400', content: 'preserved' }
  ] }));
  ok(shell, 'archive extract readonly.flar');
  assert.equal(system.getNode('readonly/nested/keep.txt').content, 'preserved');
  assert.equal(system.getNode('readonly').mode, '500');
  assert.equal(system.getNode('readonly/nested').mode, '500');
  assert.equal(system.getNode('readonly/nested/keep.txt').owner, 'jarl');
});

test('redirection keeps the path and user resolved before a command changes them', () => {
  const { system, shell } = setup();
  ok(shell, 'cd Documents > marker.txt');
  assert.equal(system.getNode('/home/jarl/marker.txt').content, '');
  assert.equal(system.getNode('/home/jarl/Documents/marker.txt'), null);
  ok(shell, 'cd ..; sudo useradd -m anna; su anna > switched.txt');
  assert.equal(system.getNode('/home/jarl/switched.txt').owner, 'jarl');
  assert.equal(system.getNode('/home/anna/switched.txt'), null);
  assert.equal(ok(shell, 'whoami'), 'anna\n');
});

test('filesystem writes and transfers cannot exceed the depth accepted on reload', () => {
  const { system, storage } = setup();
  system.writeFile('precious.txt', 'keep me');
  let deepest = '/tmp';
  for (let depth = 2; depth <= 80; depth++) {
    deepest += '/d';
    system.mkdir(deepest);
  }
  assert.throws(() => system.mkdir(deepest + '/too-deep'), /80/);
  assert.throws(() => system.writeFile(deepest + '/too-deep.txt', 'invalid'), /80/);
  system.mkdir('bundle');
  system.writeFile('bundle/child.txt', 'nested');
  const parent = deepest.slice(0, deepest.lastIndexOf('/'));
  assert.throws(() => system.copy('bundle', parent));
  assert.throws(() => system.move('bundle', parent));
  assert.equal(system.getNode(parent + '/bundle'), null);
  assert.equal(system.getNode('bundle/child.txt').content, 'nested');
  const reloaded = new SystemCore({ storage });
  assert.equal(reloaded.storageError, null);
  assert.equal(reloaded.getNode('precious.txt').content, 'keep me');
  assert.equal(reloaded.getNode(deepest).type, 'dir');
});

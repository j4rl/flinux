import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemCore } from '../src/system.js';
import { createTrainingCore } from '../src/training-core.js';

function setup() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const system = new SystemCore({ storage, now: () => 1770000000000, reload: () => {} });
  return { system, training: createTrainingCore(system) };
}

test('system training files belong to root and opening another session preserves permissions', () => {
  const { system, training } = setup();
  for (const path of ['/root', '/proc', '/proc/cpuinfo', '/etc/hostname', '/etc/resolv.conf']) {
    assert.equal(system.getNode(path).owner, 'root', path);
    assert.equal(system.getNode(path).group, 'root', path);
  }
  assert.throws(() => training.writeFile('/root/private.txt', 'secret', false, 'jarl'), /Permission denied/);
  assert.throws(() => training.writeFile('/etc/resolv.conf', '', false, 'jarl'), /Permission denied/);
  training.chmod('/etc/resolv.conf', '666', 'root');
  training.chmod('/tmp', '750', 'root');
  createTrainingCore(system);
  assert.equal(system.getNode('/etc/resolv.conf').mode, '666');
  assert.equal(system.getNode('/tmp').mode, '750');
});

test('DNS lab checks do not publish changes or recursively redraw subscribers', () => {
  const { system, training } = setup();
  training.startLab('dns');
  let notifications = 0;
  const unsubscribe = system.onChange(() => { notifications++; });
  assert.equal(training.checkLab().ok, false);
  assert.equal(notifications, 0);
  system.writeFile('/etc/resolv.conf', 'nameserver 192.168.1.1\n');
  notifications = 0;
  assert.equal(training.checkLab().ok, true);
  assert.equal(notifications, 0);
  unsubscribe();
});

test('permissions lab accepts group access and rejects inaccessible parent directories', () => {
  const { training } = setup();
  training.startLab('permissions');
  training.chown('/var/www/html/index.html', 'root', 'www-data', 'root');
  training.chmod('/var/www/html/index.html', '640', 'root');
  assert.equal(training.checkLab().ok, true);
  training.chmod('/var/www/html/index.html', '644', 'root');
  training.chmod('/var/www/html', '700', 'root');
  assert.equal(training.checkLab().ok, false);
});

test('copy checks every descendant before copying a directory', () => {
  const { system, training } = setup();
  training.mkdir('/tmp/shared', 'root');
  training.writeFile('/tmp/shared/secret.txt', 'secret', false, 'root', '600');
  assert.throws(() => training.copy('/tmp/shared', '/home/jarl/copied', 'jarl'), /Permission denied/);
  assert.equal(system.getNode('/home/jarl/copied'), null);
});

test('copy cannot replace an unwritable file and creates files owned by its caller', () => {
  const { system, training } = setup();
  training.writeFile('/tmp/locked.txt', 'original', false, 'root', '644');
  training.writeFile('/home/jarl/source.txt', 'replacement', false, 'jarl');
  assert.throws(() => training.copy('/home/jarl/source.txt', '/tmp/locked.txt', 'jarl'), /Permission denied/);
  assert.equal(system.getNode('/tmp/locked.txt').content, 'original');
  training.copy('/tmp/locked.txt', '/home/jarl/copy.txt', 'jarl');
  assert.equal(system.getNode('/home/jarl/copy.txt').owner, 'jarl');
  training.writeFile('/home/jarl/copy.txt', 'editable', false, 'jarl');
});

test('move checks source directory write access instead of source file read access', () => {
  const { system, training } = setup();
  assert.throws(() => training.move('/etc/hostname', '/tmp/hostname', 'jarl'), /Permission denied/);
  assert.ok(system.getNode('/etc/hostname'));
  training.writeFile('/home/jarl/unreadable', 'secret', false, 'jarl', '000');
  training.move('/home/jarl/unreadable', '/home/jarl/renamed', 'jarl');
  assert.equal(system.getNode('/home/jarl/unreadable'), null);
  assert.equal(system.getNode('/home/jarl/renamed').content, 'secret');
});

test('file access and metadata changes require traversal through all parents', () => {
  const { system, training } = setup();
  training.writeFile('/home/jarl/owned.txt', 'content', false, 'jarl');
  training.chmod('/home', '700', 'root');
  assert.throws(() => training.chmod('/home/jarl/owned.txt', '600', 'jarl'), /Permission denied/);
  assert.throws(() => training.chgrp('/home/jarl/owned.txt', 'sudo', 'jarl'), /Permission denied/);
  training.chmod('/home', '755', 'root');
  system.chmod('/', '700');
  assert.throws(() => training.read('/home/jarl/owned.txt', 'jarl'), /Permission denied/);
});

test('existing training sessions follow imported accounts, network and active lab state', () => {
  const { system, training } = setup();
  training.addUser('anna', { sudo: true });
  training.startLab('dns');
  const backup = JSON.parse(JSON.stringify(system.state));
  training.resetLab();
  training.deleteUser('anna', true);
  system.importState(backup);
  assert.equal(training.user('anna').name, 'anna');
  assert.equal(training.state.activeLab, 'dns');
  assert.equal(training.resolveHost('server'), null);
  training.addUser('bob');
  assert.ok(system.state.training.users.bob);
  assert.equal(training.resetLab(), true);
  assert.equal(system.state.training.activeLab, null);
  assert.equal(training.resolveHost('server'), '192.168.1.20');
});

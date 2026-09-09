import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemCore } from '../src/system.js';
import { createShellSession } from '../src/terminal.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function setup() {
  const system = new SystemCore({ storage: memoryStorage(), now: () => 1770000000000, reload: () => {} });
  const shell = createShellSession({ system });
  return { system, shell };
}
function ok(shell, command) {
  const response = shell.execute(command);
  assert.equal(response.code, 0, command + ': ' + response.stderr);
  return response.stdout;
}

test('training core creates Linux account files and ownership metadata', () => {
  const { system, shell } = setup();
  assert.match(ok(shell, 'cat /etc/passwd'), /jarl:x:1000:1000/);
  assert.match(ok(shell, 'ls -l /home/jarl'), /jarl\s+jarl/);
  assert.equal(system.getNode('/etc/shadow').owner, 'root');
  assert.equal(system.getNode('/etc/shadow').mode, '640');
});

test('sudo user management and permissions affect actual shell access', () => {
  const { system, shell } = setup();
  ok(shell, 'sudo useradd -m anna');
  ok(shell, 'sudo usermod -aG sudo anna');
  assert.match(ok(shell, 'id anna'), /sudo/);
  assert.ok(system.getNode('/home/anna'));

  ok(shell, 'sudo touch /root/secret.txt');
  ok(shell, 'sudo chmod 600 /root/secret.txt');
  const denied = shell.execute('cat /root/secret.txt');
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /Permission denied/);
});

test('Apache reads web files as www-data', () => {
  const { shell } = setup();
  ok(shell, 'sudo apt install apache2');
  ok(shell, 'sudo systemctl start apache2');
  ok(shell, 'sudo chmod 600 /var/www/html/index.html');
  assert.equal(shell.execute('curl localhost').code, 1);
  ok(shell, 'sudo chmod 604 /var/www/html/index.html');
  assert.match(ok(shell, 'curl localhost'), /Det glada linuxet/);
});

test('virtual network distinguishes IP reachability from DNS', () => {
  const { shell } = setup();
  assert.match(ok(shell, 'ip addr'), /192\.168\.1\.10/);
  assert.match(ok(shell, 'ping 192.168.1.20'), /2 received/);
  ok(shell, "sudo sh -c 'true'");
  ok(shell, "sudo chmod 644 /etc/resolv.conf");
  ok(shell, "sudo sh");
});

test('lab scenarios are checked from system state rather than command history', () => {
  const { shell } = setup();
  ok(shell, 'lab start filesystem');
  let status = shell.execute('lab status');
  assert.equal(status.code, 1);
  ok(shell, 'mkdir ~/lab');
  ok(shell, 'echo flinux > ~/lab/answer.txt');
  status = shell.execute('lab status');
  assert.equal(status.code, 0);
  assert.match(status.stdout, /KLAR/);
});

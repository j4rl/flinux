import { PACKAGE_REGISTRY as DEFAULT_REGISTRY } from './system.js';
import { createTrainingCore } from './training-core.js';
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const lines = text => text === '' ? [] : String(text).replace(/\n$/, '').split('\n');
const line = text => String(text) + '\n';
const result = (stdout = '', code = 0, stderr = '') => ({ stdout, code, stderr });
const bytes = text => new TextEncoder().encode(text).length;
const usage = text => { throw new Error('Användning: ' + text); };
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const globPattern = text => new RegExp('^' + text.split('*').map(part => part.split('?').map(escapePattern).join('.')).join('.*') + '$');
const permissions = node => (node.type === 'dir' ? 'd' : '-') + [...(node.mode || (node.type === 'dir' ? '755' : '644'))].map(n => [4, 2, 1].map((bit, i) => Number(n) & bit ? 'rwx'[i] : '-').join('')).join('');

// Small shell grammar. This never invokes JavaScript or a host shell.
export function tokenizeShell(source, environment = {}) {
  const tokens = []; let word = '', started = false, quote = null, substitutions = [];
  const flush = () => { if (started) tokens.push({ kind: 'word', value: word, substitutions }); word = ''; started = false; substitutions = []; };
  const variable = index => { const match = source.slice(index + 1).match(/^(?:\{([A-Za-z_][A-Za-z0-9_]*|\?)\}|([A-Za-z_][A-Za-z0-9_]*|\?))/); if (!match) return { text: '$', length: 0 }; const name = match[1] || match[2], text = String(environment[name] ?? ''); substitutions.push({ name, offset: word.length, length: text.length }); return { text, length: match[0].length }; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote === "'") { if (char === "'") quote = null; else word += char; continue; }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\' && ['\\', '"', '$'].includes(source[i + 1])) word += source[++i];
      else if (char === '$') { const value = variable(i); word += value.text; i += value.length; }
      else word += char;
      continue;
    }
    if (/\s/.test(char)) { flush(); continue; }
    if (char === '#' && !started) break;
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (char === '\\') { if (i + 1 >= source.length) throw new Error('Ofullständig escape i slutet av raden'); word += source[++i]; started = true; continue; }
    if (char === '$') { const value = variable(i); word += value.text; i += value.length; started = true; continue; }
    if ('|&;><'.includes(char)) { flush(); let operator = char; if ((char === '|' || char === '&' || char === '>') && source[i + 1] === char) operator += source[++i]; if (operator === '&') throw new Error('Bakgrundsjobb (&) stöds inte. Använd ; för nästa kommando.'); tokens.push({ kind: 'operator', value: operator }); continue; }
    word += char; started = true;
  }
  if (quote) throw new Error('Citattecknet är inte avslutat'); flush(); return tokens;
}
function parseShell(tokens) {
  const groups = []; let commands = [], words = [], redirects = [], connector = null;
  const command = () => { if (!words.length && !redirects.length) throw new Error('Tomt kommando i kommandokedjan'); commands.push({ words, redirects }); words = []; redirects = []; };
  const group = next => { command(); groups.push({ commands, connector }); commands = []; connector = next; };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]; if (token.kind === 'word') { words.push(token); continue; }
    if (['>', '>>', '<'].includes(token.value)) { const target = tokens[++i]; if (target?.kind !== 'word') throw new Error('Omdirigeringen behöver ett filnamn'); redirects.push({ operator: token.value, path: target }); }
    else if (token.value === '|') command(); else group(token.value);
  }
  if (words.length || redirects.length) group(null); else if (commands.length || (groups.length && connector !== ';')) throw new Error('Kommandokedjan är inte avslutad');
  return groups;
}
export function createShellSession({ system, PACKAGE_REGISTRY = DEFAULT_REGISTRY, openApp = () => {}, onClear = () => {}, onExit = () => {}, onRead = null, cwd = system.state.user.home } = {}) {
  let current = system.normalize(cwd), previous = current, lastCode = 0, currentUser = system.state.user.name;
  const training = createTrainingCore(system);
  const history = [], environment = Object.assign(Object.create(null), { USER: currentUser, HOME: system.state.user.home, SHELL: '/bin/flinux', PATH: '/usr/bin:/bin', LANG: 'sv_SE.UTF-8', TERM: 'flinux-256color' });
  const setUser = name => { const user = training.user(name); if (!user) throw new Error(`su: användaren '${name}' finns inte`); currentUser = name; environment.USER = name; environment.HOME = user.home; if (!current.startsWith(user.home)) { previous = current; current = user.home; } };
  const asUser = (name, fn) => { const before = currentUser, beforeUser = environment.USER, beforeHome = environment.HOME; currentUser = name; environment.USER = name; environment.HOME = training.user(name)?.home || '/root'; try { return fn(); } finally { currentUser = before; environment.USER = beforeUser; environment.HOME = beforeHome; } };
  const path = value => system.normalize(value, current);
  const expand = token => {
    let value = token.value;
    for (const replacement of [...token.substitutions].reverse()) { const variables = { ...environment, PWD: current, OLDPWD: previous, '?': lastCode }; value = value.slice(0, replacement.offset) + String(variables[replacement.name] ?? '') + value.slice(replacement.offset + replacement.length); }
    return value;
  };
  const read = value => training.read(path(value), currentUser);
  const checkDirectory = (target, listing = true) => {
    training.assertTraverse(target, currentUser);
    if (!training.can(target, currentUser, 'execute') || (listing && !training.can(target, currentUser, 'read'))) throw new Error(`${target}: Permission denied`);
  };
  const requirePackage = name => { if (!system.state.installed.includes(name)) throw new Error(`${name}: paketet är inte installerat. Kör: sudo apt install ${name}`); };
  const fileArgs = args => { const marker = args.indexOf('--'); return marker < 0 ? args.filter(x => !x.startsWith('-') || x === '-') : [...args.slice(0, marker).filter(x => !x.startsWith('-')), ...args.slice(marker + 1)]; };
  const flags = args => args.slice(0, args.includes('--') ? args.indexOf('--') : undefined).filter(x => /^-[^-]/.test(x)).join('').replaceAll('-', '');
  const source = (files, stdin) => files.length ? files.map(value => value === '-' ? stdin : read(value)).join('') : stdin;
  const ensureArgs = (args, count, help) => { if (args.length < count) usage(help); };
  const humanSize = value => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1048576).toFixed(1)} MiB`;
  const processes = () => [...training.listProcesses(), { pid: 28, ppid: 1, user: currentUser, state: 'R', command: 'flinux-sh' }];
  const listProcesses = () => line('  PID  PPID USER       S COMMAND\n' + processes().map(process => `${String(process.pid).padStart(5)} ${String(process.ppid ?? 1).padStart(5)} ${process.user.padEnd(10)} ${process.state || 'S'} ${process.command}`).join('\n'));
  const walk = (start, visit) => { const normalized = path(start), node = system.getNode(normalized); if (!node) throw new Error(`${start}: Sökvägen finns inte`); training.assertTraverse(normalized, currentUser); const recurse = (entry, name) => { if (entry.type === 'dir') checkDirectory(name); visit(entry, name); if (entry.type === 'dir') for (const child of Object.keys(entry.children).sort()) recurse(entry.children[child], name === '/' ? '/' + child : name + '/' + child); }; recurse(node, normalized); };
  const manuals = {
    shell: 'Citat: enkla/dubbla citattecken och backslash. $HOME, $PWD och $USER.\nPipeline: cat fil | grep ord | sort. Omdirigering: >, >>, <.\nKedjor: ; (alltid), && (vid framgång), || (vid fel).\nTab kompletterar kommandon och filer. ↑/↓ historik. Ctrl+L rensar. Ctrl+C avbryter inmatning.\nVarje terminal har egen arbetskatalog och egna miljövariabler. Ingen Bash, inga värdkommandon.',
    apt: 'apt update | search ORD | show PAKET | install PAKET... | remove PAKET... | list [--installed]\nPaketen är flinux-funktioner. Storlekarna är simulerade; ingen extern paketserver används.',
    ls: 'ls [-lah] [SÖKVÄG] — lista filer; -a dolda, -l rättigheter och storlek, -h läsbara storlekar.',
    grep: 'grep [-invFc] MÖNSTER [FIL...] — filtrera filer eller standard input. Reguljära uttryck; -F söker vanlig text.',
    find: "find [SÖKVÄG] [-name '*.txt'] [-type f|d] — sök genom katalogträdet.",
    sed: "sed [-n] 's/gammalt/nytt/g' [FIL] eller sed -n '2,5p' [FIL]. Ett uttryck per körning.",
    jq: "jq [-r] '.' | '.fält.underfält' | '.[0]' | '.[]' | 'length' | 'keys' [FIL]. Ingen full jq-tolk.",
    systemctl: 'systemctl start|stop|restart|enable|disable|status|is-active TJÄNST\nsystemctl list-units — installerade virtuella tjänster. Apache kan läsas med curl localhost.',
    curl: 'curl URL — läs http://localhost/, http://flinux.local/ eller file:///sökväg. Endast virtuella resurser.',
    archive: 'archive create ARKIV.flar FIL... | list ARKIV.flar | extract ARKIV.flar [MÅLKATALOG]\nflinux eget JSON-format; skriver aldrig över befintliga filer vid extrahering.',
    chmod: 'chmod 644 FIL... — ändra Unix-rättigheter. Ägare/grupp/övriga kontrolleras av simulatorn.',
    users: 'useradd -m NAMN | usermod -aG GRUPP NAMN | userdel [-r] NAMN | groups [NAMN] | su [NAMN] | sudo KOMMANDO.',
    network: 'ip addr | ip route | ping VÄRD | ss -tulpn. Nätverket är virtuellt men DNS, adresser och tjänster hänger ihop.',
    lab: 'lab list | start ID | status | hint | reset — träningsscenarier som kontrolleras mot systemets faktiska tillstånd.',
    cut: "cut -d ':' -f 1,3 [FIL] eller cut -c 1-5 [FIL] — välj fält eller tecken.",
    tr: "tr 'a-z' 'A-Z' eller tr -d TECKEN — översätt/ta bort tecken från standard input.",
    printf: "printf FORMAT [ARGUMENT...] — stöder %s, %d, %%, \\n, \\t och \\r.",
    less: 'less FIL — öppna terminalens läsvy. Stäng med q eller Escape. I pipelines skickas texten vidare.',
    export: 'export NAMN=VÄRDE — ändra en miljövariabel i den här terminalen.'
  };
  const commands = {
    help: () => line('flinux 1.1 Träning — Linux utan risk\n\nFiler:     pwd cd ls cat touch mkdir rm rmdir cp mv find stat chmod chown chgrp\nText:      echo printf head tail wc sort uniq cut tr basename dirname\nAnvändare: whoami id groups su sudo useradd usermod userdel\nProcesser: ps kill\nNätverk:   ip ping ss\nSystem:    hostname uname date uptime df du free env export\nPaket:     apt dpkg which systemctl journalctl\nTräning:   lab\nTerminal:  help man history clear exit true false\n\nProva: lab list\nSkriv man users, man network eller man lab för hjälp.'),
    man: args => { ensureArgs(args, 1, 'man KOMMANDO'); if (!manuals[args[0]] && !own(commands, args[0])) throw new Error(`Ingen manualsida för ${args[0]}`); return line(manuals[args[0]] || `${args[0]} — ett flinux-kommando. Skriv help för en översikt.`); },
    clear: () => { onClear(); return ''; }, exit: () => { onExit(); return ''; }, true: () => '', false: () => result('', 1),
    pwd: () => line(current),
    cd: args => { const target = args[0] === '-' ? previous : path(args[0] || environment.HOME), node = system.getNode(target); if (node?.type !== 'dir') throw new Error(`cd: ${args[0] || target}: Katalogen finns inte`); checkDirectory(target, false); previous = current; current = target; return args[0] === '-' ? line(current) : ''; },
    ls: args => {
      const f = flags(args), target = path(fileArgs(args)[0] || current), node = system.getNode(target); if (!node) throw new Error(`ls: ${target}: Sökvägen finns inte`);
      if (node.type === 'dir') checkDirectory(target); else training.assertTraverse(target, currentUser);
      const names = (node.type === 'dir' ? Object.keys(node.children) : [target.split('/').pop()]).filter(name => f.includes('a') || !name.startsWith('.')).sort((a, b) => a.localeCompare(b));
      if (!f.includes('l')) return names.length ? line(names.join('  ')) : '';
      return line(names.map(name => { const child = node.type === 'dir' ? node.children[name] : node, size = child.type === 'file' ? bytes(child.content) : Object.keys(child.children).length; return `${permissions(child)} ${(child.owner || 'root').padEnd(10)} ${(child.group || 'root').padEnd(10)} ${String(f.includes('h') ? humanSize(size) : size).padStart(9)} ${new Date(child.modified || system.startedAt).toLocaleDateString('sv-SE')} ${name}`; }).join('\n'));
    },
    cat: (args, stdin) => { const text = source(fileArgs(args), stdin); return flags(args).includes('n') ? lines(text).map((value, i) => `${String(i + 1).padStart(6)}\t${value}\n`).join('') : text; },
    echo: args => { let newline = true, escapes = false; args = [...args]; while (['-n', '-e', '-ne', '-en'].includes(args[0])) { const option = args.shift(); if (option.includes('n')) newline = false; if (option.includes('e')) escapes = true; } const text = args.join(' '); return (escapes ? unescapeText(text) : text) + (newline ? '\n' : ''); },
    printf: args => { if (!args.length) return ''; let index = 1; return unescapeText(args[0]).replace(/%([sd%])/g, (_, spec) => spec === '%' ? '%' : spec === 'd' ? String(Number.parseInt(args[index++] || '0', 10) || 0) : args[index++] || ''); },
    touch: args => { const files = fileArgs(args); ensureArgs(files, 1, 'touch FIL...'); for (const value of files) { const node = system.getNode(path(value)); if (node?.type === 'dir') { if (!training.can(path(value), currentUser, 'write')) throw new Error(`touch: ${value}: Permission denied`); node.modified = system.now(); system.save(); } else training.writeFile(path(value), node?.content || '', false, currentUser); } return ''; },
    mkdir: args => { const paths = fileArgs(args); ensureArgs(paths, 1, 'mkdir [-p] KATALOG...'); for (const value of paths) { if (flags(args).includes('p')) { let built = ''; for (const part of path(value).split('/').filter(Boolean)) { built += '/' + part; const node = system.getNode(built); if (!node) training.mkdir(built, currentUser); else if (node.type !== 'dir') throw new Error(`mkdir: ${built}: Är inte en katalog`); } } else training.mkdir(path(value), currentUser); } return ''; },
    rm: args => { const files = fileArgs(args), f = flags(args); ensureArgs(files, 1, 'rm [-rf] FIL...'); for (const value of files) { const node = system.getNode(path(value)); if (!node && f.includes('f')) continue; if (node?.type === 'dir' && !/[rR]/.test(f)) throw new Error(`rm: ${value}: Är en katalog; använd -r`); training.remove(path(value), currentUser); } return ''; },
    rmdir: args => { ensureArgs(args, 1, 'rmdir KATALOG...'); for (const value of args) { const node = system.getNode(path(value)); if (node?.type !== 'dir') throw new Error(`rmdir: ${value}: Är inte en katalog`); if (Object.keys(node.children).length) throw new Error(`rmdir: ${value}: Katalogen är inte tom`); training.remove(path(value), currentUser); } return ''; },
    cp: args => transfer(args, false), mv: args => transfer(args, true),
    chmod: args => { ensureArgs(args, 2, 'chmod 644 FIL...'); args.slice(1).forEach(value => training.chmod(path(value), args[0], currentUser)); return ''; },
    chown: args => { ensureArgs(args, 2, 'chown ÄGARE[:GRUPP] FIL...'); const [owner, group] = args[0].split(':'); args.slice(1).forEach(value => training.chown(path(value), owner, group || null, currentUser)); return ''; },
    chgrp: args => { ensureArgs(args, 2, 'chgrp GRUPP FIL...'); args.slice(1).forEach(value => training.chgrp(path(value), args[0], currentUser)); return ''; },
    stat: args => { ensureArgs(args, 1, 'stat FIL...'); return args.map(value => { const node = system.getNode(path(value)); if (!node) throw new Error(`stat: ${value}: Filen finns inte`); return line(`  Fil: ${path(value)}\n  Typ: ${node.type === 'dir' ? 'katalog' : 'vanlig fil'}\n  Storlek: ${node.type === 'file' ? bytes(node.content) : Object.keys(node.children).length}\n  Rättigheter: ${node.mode} (${permissions(node)})\n  Ändrad: ${new Date(node.modified || system.startedAt).toISOString()}`); }).join('\n'); },
    head: (args, stdin) => sliceLines(args, stdin, false), tail: (args, stdin) => sliceLines(args, stdin, true),
    wc: (args, stdin) => { const files = fileArgs(args), text = source(files, stdin), f = flags(args), counts = { l: (text.match(/\n/g) || []).length, w: (text.match(/\S+/g) || []).length, c: bytes(text), m: text.length }; return line((f ? ['l', 'w', 'c', 'm'].filter(flag => f.includes(flag)) : ['l', 'w', 'c']).map(flag => counts[flag]).join(' ') + (files.length ? ' ' + files.join(' ') : '')); },
    sort: (args, stdin) => { const f = flags(args); let values = lines(source(fileArgs(args), stdin)); values.sort(f.includes('n') ? (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) : (a, b) => a.localeCompare(b, 'sv')); if (f.includes('r')) values.reverse(); if (f.includes('u')) values = [...new Set(values)]; return values.length ? line(values.join('\n')) : ''; },
    uniq: (args, stdin) => { const f = flags(args), groups = []; for (const value of lines(source(fileArgs(args), stdin))) { if (groups.at(-1)?.text === value) groups.at(-1).count++; else groups.push({ text: value, count: 1 }); } const selected = groups.filter(group => !f.includes('d') || group.count > 1).filter(group => !f.includes('u') || group.count === 1); return selected.map(group => (f.includes('c') ? String(group.count).padStart(7) + ' ' : '') + group.text + '\n').join(''); },
    cut: (args, stdin) => { let delimiter = '\t', fields = null, chars = null; const files = []; for (let i = 0; i < args.length; i++) { const arg = args[i]; if (arg === '-d') delimiter = args[++i]; else if (arg.startsWith('-d')) delimiter = arg.slice(2); else if (arg === '-f') fields = args[++i]; else if (arg.startsWith('-f')) fields = arg.slice(2); else if (arg === '-c') chars = args[++i]; else if (arg.startsWith('-c')) chars = arg.slice(2); else files.push(arg); } if ((!fields && !chars) || delimiter == null || delimiter.length !== 1) usage(manuals.cut); return lines(source(files, stdin)).map(value => { const values = chars ? [...value] : value.split(delimiter), selected = selectIndices(fields || chars, values.length); return selected.map(i => values[i] ?? '').join(chars ? '' : delimiter) + '\n'; }).join(''); },
    tr: (args, stdin) => { const deleting = args[0] === '-d'; if (deleting) args = args.slice(1); ensureArgs(args, deleting ? 1 : 2, manuals.tr); const from = expandRange(unescapeText(args[0])), to = deleting ? '' : expandRange(unescapeText(args[1])); if (!deleting && !to.length) throw new Error('tr: den andra teckenuppsättningen är tom'); return [...stdin].map(char => { const index = from.indexOf(char); return index < 0 ? char : deleting ? '' : to[Math.min(index, to.length - 1)]; }).join(''); },
    find: args => { const start = args[0] && !args[0].startsWith('-') ? args[0] : '.', nameIndex = args.indexOf('-name'), typeIndex = args.indexOf('-type'), pattern = nameIndex < 0 ? null : globPattern(args[nameIndex + 1] || ''), type = typeIndex < 0 ? null : args[typeIndex + 1], found = []; if (type && !['f', 'd'].includes(type)) usage('find [KATALOG] [-name MÖNSTER] [-type f|d]'); walk(start, (node, value) => { if ((!pattern || pattern.test(value.split('/').pop())) && (!type || (node.type === 'file' ? 'f' : 'd') === type)) found.push(value); }); return found.length ? line(found.join('\n')) : ''; },
    basename: args => { ensureArgs(args, 1, 'basename SÖKVÄG [SUFFIX]'); let name = args[0].replace(/\/+$/, '').split('/').pop() || '/'; if (args[1] && name.endsWith(args[1])) name = name.slice(0, -args[1].length); return line(name); },
    dirname: args => { ensureArgs(args, 1, 'dirname SÖKVÄG'); const value = args[0].replace(/\/+$/, ''), index = value.lastIndexOf('/'); return line(index < 0 ? '.' : value.slice(0, index) || '/'); },
    which: args => { ensureArgs(args, 1, 'which KOMMANDO...'); return args.map(name => { if (!isAvailable(name)) throw new Error(`${name}: kommandot hittades inte`); return `/usr/bin/${name}\n`; }).join(''); },
    whoami: () => line(currentUser), hostname: () => line(system.state.user.host),
    id: args => line(training.idText(args[0] || currentUser)),
    groups: args => line(training.groupsFor(args[0] || currentUser).join(' ')),
    su: args => { const target = args[0] || 'root'; if (target === 'root' && currentUser !== 'root') throw new Error('su: Authentication failure — lösenordsprompt simuleras inte; använd sudo för administrativa kommandon.'); setUser(target); return ''; },
    useradd: args => { training.requireRoot(currentUser, 'useradd'); const names = args.filter(a => !a.startsWith('-')); ensureArgs(names, 1, 'useradd [-m] NAMN'); training.addUser(names.at(-1), { createHome: args.includes('-m') }); return ''; },
    userdel: args => { training.requireRoot(currentUser, 'userdel'); const names = args.filter(a => !a.startsWith('-')); ensureArgs(names, 1, 'userdel [-r] NAMN'); training.deleteUser(names.at(-1), args.includes('-r')); return ''; },
    usermod: args => { training.requireRoot(currentUser, 'usermod'); const groupIndex = args.findIndex(a => a === '-G' || a === '-aG'); if (groupIndex < 0 || !args[groupIndex + 1] || !args.at(-1)) usage('usermod -aG GRUPP NAMN'); for (const group of args[groupIndex + 1].split(',')) training.addToGroup(args.at(-1), group); return ''; },
    uname: args => line(flags(args).includes('a') ? `flinux ${system.state.user.host} 1.0.0-web browser JavaScript` : flags(args).includes('r') ? '1.0.0-web' : flags(args).includes('m') ? 'browser' : flags(args).includes('n') ? system.state.user.host : 'flinux'),
    date: args => line(args.includes('-u') ? new Date().toUTCString() : args[0] === '+%F' ? new Date().toLocaleDateString('sv-SE') : new Date().toLocaleString('sv-SE')),
    uptime: () => line(`up ${Math.floor((system.now() - system.startedAt) / 1000)} sekunder, ${system.state.installed.length} paket, ${processes().length} virtuella processer`),
    ps: () => listProcesses(),
    kill: args => { ensureArgs(args, 1, 'kill PID'); const pid = args.find(a => /^\d+$/.test(a)); if (!pid) usage('kill [-9] PID'); training.kill(pid, currentUser); return ''; },
    ip: args => { if (!args.length || ['addr','a','address'].includes(args[0])) return training.ipAddressText(); if (['route','r'].includes(args[0])) return training.routeText(); usage('ip addr | ip route'); },
    ping: args => { ensureArgs(args, 1, 'ping VÄRD'); training.syncDnsFromFile(); const host = args.find(a => !a.startsWith('-')); const resolved = training.resolveHost(host); if (!resolved) return result('', 2, line(`ping: ${host}: Temporary failure in name resolution`)); return line(`PING ${host} (${resolved}) 56(84) bytes of data.\n64 bytes from ${resolved}: icmp_seq=1 ttl=64 time=0.42 ms\n64 bytes from ${resolved}: icmp_seq=2 ttl=64 time=0.39 ms\n\n--- ${host} ping statistics ---\n2 packets transmitted, 2 received, 0% packet loss`); },
    ss: () => training.socketText(),
    df: () => line(`Filsystem    Använt       Monterat\nflinuxfs     ${humanSize(system.filesystemStats().bytes).padEnd(12)} /\nLagring: webbläsarens localStorage (kvoten bestäms av webbläsaren).`),
    du: args => { const paths = fileArgs(args); return (paths.length ? paths : ['.']).map(value => line(`${flags(args).includes('h') ? humanSize(system.filesystemStats(path(value)).bytes) : system.filesystemStats(path(value)).bytes}\t${value}`)).join(''); },
    free: () => line(`Virtuellt filinnehåll: ${humanSize(system.filesystemStats().bytes)}\nPaketens simulerade storlek: ${system.state.installed.reduce((sum, name) => sum + PACKAGE_REGISTRY[name].size, 0)} KiB\nVärddatorns RAM är inte tillgängligt för simulatorn.`),
    env: () => line(Object.entries({ ...environment, PWD: current, OLDPWD: previous }).map(([name, value]) => `${name}=${value}`).join('\n')),
    export: args => { if (!args.length) return commands.env(); for (const value of args) { const match = value.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s); if (!match) throw new Error('export: använd NAMN=VÄRDE'); environment[match[1]] = match[2]; } return ''; },
    unset: args => { args.forEach(name => delete environment[name]); return ''; },
    history: () => line(history.map((value, i) => `${String(i + 1).padStart(4)}  ${value}`).join('\n')),
    apt: args => apt(args), dpkg: args => args.includes('-l') ? apt(['list', '--installed']) : usage('dpkg -l'),
    sudo: (args, stdin, context) => { ensureArgs(args, 1, 'sudo KOMMANDO'); if (!training.isSudoer(currentUser)) throw new Error(`${currentUser} is not in the sudoers file.`); if (args[0] === 'sudo') throw new Error('sudo: nästlad sudo behövs inte i flinux'); return asUser('root', () => run(args, stdin, context)); },
    systemctl: args => serviceCommand(args),
    journalctl: args => { const name = args[0] === '-u' ? args[1] : null; if (name) { const service = system.getService(name); return line(`${name}: ${service.active ? 'aktiv' : 'stoppad'}${service.since ? ' sedan ' + new Date(service.since).toLocaleString('sv-SE') : ''}`); } return system.state.packageLog.length ? line(system.state.packageLog.join('\n')) : line('Inga paketåtgärder har loggats ännu.'); },
    neofetch: () => line(`   ╭────────╮   ${environment.USER}@${system.state.user.host}\n   │  ◕  ◕  │   OS: flinux 1.0 Glimten\n   │  ╰──╯  │   Det glada linuxet\n   ╰────────╯   Skrivbord: ${system.state.settings.desktop}\n     ╱    ╲     Paket: ${system.state.installed.length}\n                Shell: flinux-sh\n                Drifttid: ${Math.floor((system.now() - system.startedAt) / 1000)} s\n                Filer: ${system.filesystemStats().files}\n                Runtime: JavaScript / webbläsare`),
    tree: args => { const output = [path(fileArgs(args)[0] || '.')], root = system.getNode(output[0]); if (!root) throw new Error('tree: sökvägen finns inte'); training.assertTraverse(output[0], currentUser); const visit = (node, prefix, absolute) => { if (node.type !== 'dir') return; checkDirectory(absolute); const entries = Object.entries(node.children).filter(([name]) => flags(args).includes('a') || !name.startsWith('.')).sort(([a], [b]) => a.localeCompare(b)); entries.forEach(([name, child], i) => { const last = i === entries.length - 1; output.push(prefix + (last ? '└── ' : '├── ') + name); visit(child, prefix + (last ? '    ' : '│   '), absolute.replace(/\/$/, '') + '/' + name); }); }; visit(root, '', output[0]); return line(output.join('\n')); },
    grep: (args, stdin) => { const values = fileArgs(args); ensureArgs(values, 1, manuals.grep); const f = flags(args), pattern = values.shift(); let regex; try { regex = new RegExp(f.includes('F') ? escapePattern(pattern) : pattern, f.includes('i') ? 'i' : ''); } catch { throw new Error('grep: ogiltigt reguljärt uttryck'); } const selected = lines(source(values, stdin)).map((text, i) => ({ text, i })).filter(entry => regex.test(entry.text) !== f.includes('v')); return result(f.includes('c') ? line(selected.length) : selected.map(entry => (f.includes('n') ? entry.i + 1 + ':' : '') + entry.text + '\n').join(''), selected.length ? 0 : 1); },
    sed: (args, stdin) => { const values = fileArgs(args); ensureArgs(values, 1, manuals.sed); const expression = values.shift(), text = source(values, stdin), match = expression.match(/^s(.)(.*?)\1(.*?)\1([gi]*)$/); if (match) { let regex; try { regex = new RegExp(match[2], match[4]); } catch { throw new Error('sed: ogiltigt reguljärt uttryck'); } return text.split('\n').map(value => value.replace(regex, match[3].replace(/&/g, '$&'))).join('\n'); } const range = expression.match(/^(\d+)(?:,(\d+))?p$/); if (range && args.includes('-n')) return lines(text).slice(Number(range[1]) - 1, Number(range[2] || range[1])).map(line).join(''); usage(manuals.sed); },
    jq: (args, stdin) => { const values = fileArgs(args); ensureArgs(values, 1, manuals.jq); const filter = values.shift(); let value; try { value = JSON.parse(source(values, stdin)); } catch { throw new Error('jq: ogiltig JSON'); } let selected; if (filter === '.') selected = [value]; else if (filter === 'length') selected = [value == null ? 0 : typeof value === 'object' ? Object.keys(value).length : value.length ?? 0]; else if (filter === 'keys') selected = [Object.keys(value ?? {}).sort()]; else if (filter === '.[]') selected = Object.values(value ?? {}); else { if (!/^\.(?:[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*|\[\d+\])$/.test(filter)) usage(manuals.jq); for (const key of filter.startsWith('.[') ? [filter.slice(2, -1)] : filter.slice(1).split('.')) value = value != null && own(Object(value), key) ? value[key] : null; selected = [value]; } return selected.map(value => (args.includes('-r') && typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n').join(''); },
    cowsay: (args, stdin) => { const text = args.join(' ') || stdin.trim() || 'Det glada linuxet!', wrapped = text.match(/.{1,60}/g) || ['']; const width = Math.max(...wrapped.map(value => value.length)); return line(' ' + '_'.repeat(width + 2) + '\n' + wrapped.map(value => '< ' + value.padEnd(width) + ' >').join('\n') + '\n ' + '-'.repeat(width + 2) + '\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||'); },
    fortune: () => line(['Ett litet flin gör terminalen gladare.', 'Hem är där din $HOME finns.', 'Må dina paketberoenden alltid gå ihop.', 'Det enkla som fungerar slår det perfekta som aldrig blir klart.', 'Spara först. Experimentera sedan.'][Math.floor(Math.random() * 5)]),
    figlet: (args, stdin) => figlet(args.join(' ') || stdin.trim() || 'FLINUX'),
    nano: args => { const value = path(args[0] || 'anteckningar.txt'); openApp('kate', { path: value }); return line(`Öppnade ${value} i Kate (flinux nano-genväg).`); },
    htop: () => listProcesses() + line(`\n${processes().length} virtuella processer · ${system.state.installed.length} paket · ${humanSize(system.filesystemStats().bytes)} filinnehåll`),
    apachectl: args => serviceCommand([args[0] === '-k' ? args[1] : args[0] || 'status', 'apache2']),
    curl: args => { const values = fileArgs(args); ensureArgs(values, 1, manuals.curl); return fetchVirtual(values[0]); },
    wget: args => { const outputIndex = args.indexOf('-O'), target = outputIndex >= 0 ? args[outputIndex + 1] : null, values = args.filter((value, i) => !value.startsWith('-') && (outputIndex < 0 || i !== outputIndex + 1)); ensureArgs(values, 1, 'wget [-O FIL] URL'); const url = values[0], content = fetchVirtual(url), destination = path(target || new URL(url.includes('://') ? url : 'http://' + url).pathname.split('/').pop() || 'index.html'); training.writeFile(destination, content, false, currentUser); return line(`Sparade ${bytes(content)} byte till ${destination}`); },
    less: (args, stdin, context) => { const text = source(fileArgs(args), stdin); if (onRead && !context.piped && !context.redirected) { onRead(text, args[0] || 'standard input'); return ''; } return text; },
    base64: (args, stdin) => { const text = source(fileArgs(args), stdin); try { if (flags(args).includes('d')) { const binary = atob(text.replace(/\s/g, '')); return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))); } const encoded = new TextEncoder().encode(text); let binary = ''; for (const byte of encoded) binary += String.fromCharCode(byte); return line(btoa(binary)); } catch { throw new Error('base64: ogiltiga indata'); } },
    diff: args => { ensureArgs(args, 2, 'diff FIL1 FIL2'); const first = read(args[0]), second = read(args[1]); if (first === second) return ''; return result(line(`--- ${args[0]}\n+++ ${args[1]}\n` + lines(first).map(value => '- ' + value).join('\n') + '\n' + lines(second).map(value => '+ ' + value).join('\n')), 1); },
    cal: args => { const now = new Date(), month = args.length ? Number(args[0]) : now.getMonth() + 1, year = args.length > 1 ? Number(args[1]) : now.getFullYear(); if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 100 || year > 9999) usage('cal [MÅNAD 1–12] [ÅR 100–9999]'); const start = new Date(year, month - 1, 1), count = new Date(year, month, 0).getDate(), offset = (start.getDay() + 6) % 7, cells = Array(offset).fill('  '); for (let day = 1; day <= count; day++) cells.push(String(day).padStart(2)); const rows = []; while (cells.length) rows.push(cells.splice(0, 7).join(' ')); return line(start.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' }) + '\nmå ti on to fr lö sö\n' + rows.join('\n')); },
    lab: args => { const action = args[0] || 'list'; if (action === 'list') return line(training.labs.map(l => `${l.id.padEnd(12)} ${l.level.padEnd(6)} ${l.title}`).join('\n')); if (action === 'start') { ensureArgs(args, 2, 'lab start ID'); const lab = training.startLab(args[1]); return line(`${lab.title}\n${lab.description}`); } if (action === 'status') { const check = training.checkLab(); return result(line(`${check.ok ? 'KLAR' : 'INTE KLAR'} — ${check.message}`), check.ok ? 0 : 1); } if (action === 'hint') { const lab = training.labs.find(l => l.id === training.state.activeLab); return line(lab ? lab.hint : 'Ingen labb är startad.'); } if (action === 'reset') return line(training.resetLab() ? 'Labben återställd.' : 'Ingen labb att återställa.'); usage(manuals.lab); },
    archive: args => archive(args)
  };
  const packageCommands = Object.create(null);
  for (const [name, pkg] of Object.entries(PACKAGE_REGISTRY)) {
    if (pkg.command) packageCommands[pkg.command] = name;
    if (pkg.app) for (const command of new Set([name, pkg.command].filter(Boolean))) { packageCommands[command] = name; if (!own(commands, command)) commands[command] = args => { openApp(pkg.app, args[0] ? { path: path(args[0]) } : {}); return line(`Startar ${name}…`); }; }
  }
  function isAvailable(name) { return own(commands, name) && (!own(packageCommands, name) || system.state.installed.includes(packageCommands[name])); }
  function run(words, stdin, context = {}) {
    const [name, ...args] = words; if (!name) return result(stdin);
    if (!own(commands, name)) throw new Error(`${name}: kommandot hittades inte. Skriv help eller apt search ${name}.`);
    if (own(packageCommands, name)) requirePackage(packageCommands[name]);
    if (args[0] === '--help') return result(line(manuals[name] || `${name} — ${PACKAGE_REGISTRY[packageCommands[name]]?.description || 'flinux-kommando'}. Skriv man shell för syntax.`));
    const output = commands[name](args, stdin, context); return typeof output === 'object' && output !== null ? output : result(output ?? '');
  }
  function transfer(args, move) {
    const files = fileArgs(args); ensureArgs(files, 2, `${move ? 'mv' : 'cp [-r]'} KÄLLA... MÅL`); const destination = files.pop();
    if (files.length > 1 && system.getNode(path(destination))?.type !== 'dir') throw new Error('Flera källfiler kräver en målkatalog');
    for (const source of files) { if (!move && system.getNode(path(source))?.type === 'dir' && !/[rR]/.test(flags(args))) throw new Error('cp: kataloger kräver -r'); training[move ? 'move' : 'copy'](path(source), path(destination), currentUser); } return '';
  }
  function sliceLines(args, stdin, tail) {
    let count = 10; const files = [];
    for (let i = 0; i < args.length; i++) { if (args[i] === '-n') count = Number(args[++i]); else if (/^-\d+$/.test(args[i])) count = Number(args[i].slice(1)); else files.push(args[i]); }
    if (!Number.isInteger(count) || count < 0) throw new Error('Antalet rader måste vara ett positivt heltal eller 0');
    const values = lines(source(files, stdin)), selected = count === 0 ? [] : tail ? values.slice(-count) : values.slice(0, count); return selected.map(line).join('');
  }
  function apt(args) {
    const [action, ...names] = args;
    if (action === 'update') return line(`flinux lokal paketkälla\n${Object.keys(PACKAGE_REGISTRY).length} paket tillgängliga. Paketlistorna är uppdaterade.`);
    if (action === 'search') { const query = names.join(' ').toLowerCase(); return line(Object.entries(PACKAGE_REGISTRY).filter(([name, pkg]) => `${name} ${pkg.description}`.toLowerCase().includes(query)).map(([name, pkg]) => `${name}/${pkg.version}${system.state.installed.includes(name) ? ' [installerat]' : ''}\n  ${pkg.description}`).join('\n') || 'Inga paket hittades.'); }
    if (action === 'list') return line(Object.entries(PACKAGE_REGISTRY).filter(([name]) => !names.includes('--installed') || system.state.installed.includes(name)).map(([name, pkg]) => `${name}/${pkg.version}${system.state.installed.includes(name) ? ' [installed]' : ''}`).join('\n'));
    if (action === 'show') { ensureArgs(names, 1, 'apt show PAKET'); if (!own(PACKAGE_REGISTRY, names[0])) throw new Error('Paketet finns inte'); const pkg = PACKAGE_REGISTRY[names[0]]; return line(`Package: ${names[0]}\nVersion: ${pkg.version}\nSize: ${pkg.size} KiB (simulerad)\nDepends: ${pkg.dependencies.join(', ') || 'inga'}\nDescription: ${pkg.description}`); }
    if (action === 'install' || action === 'remove' || action === 'uninstall') { const packages = names.filter(name => name !== '-y'); ensureArgs(packages, 1, `apt ${action} PAKET...`); return packages.map(name => line(system[action === 'install' ? 'install' : 'uninstall'](name))).join(''); }
    usage(manuals.apt);
  }
  function serviceCommand(args) {
    const [action, name] = args;
    if (!action || ['list-units', 'list-unit-files'].includes(action)) return line(Object.entries(PACKAGE_REGISTRY).filter(([pkgName, pkg]) => pkg.service && system.state.installed.includes(pkgName)).map(([pkgName]) => { const service = system.getService(pkgName); return `${pkgName}.service  ${service.active ? 'active (running)' : 'inactive (dead)'}  ${service.enabled ? 'enabled' : 'disabled'}`; }).join('\n') || 'Inga tjänstepaket installerade. Prova apt install apache2.');
    ensureArgs(args, 2, manuals.systemctl); const service = system.getService(name);
    if (action === 'status') return result(line(`● ${name.replace(/\.service$/, '')}.service — flinux virtuell tjänst\n  Loaded: ${service.enabled ? 'enabled' : 'disabled'}\n  Active: ${service.active ? 'active (running)' : 'inactive (dead)'}`), service.active ? 0 : 3);
    if (action === 'is-active') return result(line(service.active ? 'active' : 'inactive'), service.active ? 0 : 3);
    system.setService(name, action); return line(`${name}: ${action} klart.`);
  }
  function fetchVirtual(url) {
    if (url.startsWith('file://')) return read(decodeURIComponent(url.slice(7)));
    let parsed; try { parsed = new URL(url.includes('://') ? url : 'http://' + url); } catch { throw new Error('curl: ogiltig URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || !['localhost', 'flinux.local', '127.0.0.1'].includes(parsed.hostname)) throw new Error('curl: endast virtuella adresser stöds: http://localhost/ eller file:///sökväg');
    requirePackage('apache2'); if (!system.getService('apache2').active) throw new Error('curl: anslutningen nekades. Kör systemctl start apache2.');
    let request; try { request = decodeURIComponent(parsed.pathname); } catch { throw new Error('curl: ogiltig URL-kodning'); }
    const target = system.normalize('/var/www/html/' + request); if (target !== '/var/www/html' && !target.startsWith('/var/www/html/')) throw new Error('curl: 403 Forbidden');
    return training.read(system.getNode(target)?.type === 'dir' ? target + '/index.html' : target, 'www-data');
  }
  function archive(args) {
    ensureArgs(args, 2, manuals.archive); const [action, archivePath, ...entries] = args;
    if (action === 'create') {
      ensureArgs(entries, 1, manuals.archive); const stored = [], seen = new Set();
      for (const value of entries) { const initial = path(value), base = initial.split('/').pop(); if (!base) throw new Error('archive: välj filer eller underkataloger'); walk(initial, (node, absolute) => { const name = base + absolute.slice(initial.length); if (seen.has(name)) throw new Error('archive: filnamn kolliderar'); seen.add(name); stored.push({ path: name, type: node.type, mode: node.mode, ...(node.type === 'file' ? { content: read(absolute) } : {}) }); }); }
      training.writeFile(path(archivePath), JSON.stringify({ format: 'flinux-archive-1', entries: stored }, null, 2), false, currentUser); return line(`Skapade ${archivePath}: ${stored.length} poster.`);
    }
    let archive; try { archive = JSON.parse(read(archivePath)); } catch { throw new Error('archive: ogiltigt arkiv'); }
    if (archive.format !== 'flinux-archive-1' || !Array.isArray(archive.entries)) throw new Error('archive: formatet stöds inte');
    if (action === 'list') return line(archive.entries.map(entry => entry.path).join('\n'));
    if (action !== 'extract') usage(manuals.archive);
    const destination = path(entries[0] || '.'), targets = new Map(); if (system.getNode(destination)?.type !== 'dir') throw new Error('archive: målkatalogen finns inte');
    for (const entry of archive.entries) {
      if (!entry || typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.split('/').some(part => !part || part === '..' || part === '.') || entry.path.includes('\0') || !['file', 'dir'].includes(entry.type) || (entry.type === 'file' && typeof entry.content !== 'string')) throw new Error('archive: osäker eller ogiltig arkivpost');
      const target = system.normalize(destination + '/' + entry.path); if (!target.startsWith(destination === '/' ? '/' : destination + '/') || target.split('/').filter(Boolean).length > 80 || targets.has(target) || system.getNode(target)) throw new Error('archive: målfilen finns redan eller sökvägen är ogiltig'); targets.set(target, entry);
    }
    const ordered = [...targets.entries()].sort(([a], [b]) => a.split('/').length - b.split('/').length);
    for (const [target] of ordered) { const parent = target.slice(0, target.lastIndexOf('/')) || '/'; if (system.getNode(parent)?.type === 'dir') training.parentWritable(target, currentUser); else if (targets.get(parent)?.type !== 'dir') throw new Error('archive: överordnad katalog saknas'); }
    for (const [target, entry] of ordered) { if (entry.type === 'dir') training.mkdir(target, currentUser); else training.writeFile(target, entry.content, false, currentUser); }
    for (const [target, entry] of [...ordered].reverse()) if (/^[0-7]{3}$/.test(entry.mode)) training.chmod(target, entry.mode, currentUser);
    return line(`Extraherade ${ordered.length} poster till ${destination}.`);
  }
  return {
    get cwd() { return current; }, get history() { return [...history]; }, get exitCode() { return lastCode; },
    get prompt() { const sigil = currentUser === 'root' ? '#' : '$'; return `${currentUser}@${system.state.user.host}:${current === environment.HOME || current.startsWith(environment.HOME + '/') ? '~' + current.slice(environment.HOME.length) : current}${sigil}`; },
    execute(raw) {
      if (!raw.trim()) return result(); history.push(raw); if (history.length > 500) history.shift();
      let groups; try { groups = parseShell(tokenizeShell(raw, { ...environment, PWD: current, OLDPWD: previous, '?': lastCode })); } catch (error) { lastCode = 2; return result('', 2, line(error.message)); }
      let stdout = '', stderr = '';
      for (const group of groups) {
        if ((group.connector === '&&' && lastCode !== 0) || (group.connector === '||' && lastCode === 0)) continue;
        let stdin = '', code = 0;
        for (let i = 0; i < group.commands.length; i++) {
          const command = group.commands[i];
          try {
            const redirectUser = currentUser;
            const redirects = command.redirects.map(redirect => { const expanded = expand(redirect.path); if (!expanded) throw new Error('Omdirigeringen behöver ett filnamn'); return { ...redirect, path: path(expanded) }; });
            for (const redirect of redirects) { if (redirect.operator === '<') stdin = read(redirect.path); else training.writeFile(redirect.path, '', redirect.operator === '>>', redirectUser); }
            const output = run(command.words.map(expand), stdin, { piped: group.commands.length > 1, redirected: redirects.some(redirect => redirect.operator !== '<') }); stdin = output.stdout; code = output.code; stderr += output.stderr;
            const writes = redirects.filter(redirect => redirect.operator !== '<'); if (writes.length) { const redirect = writes.at(-1); training.writeFile(redirect.path, stdin, true, redirectUser); stdin = ''; }
          } catch (error) { stderr += line(error.message); stdin = ''; code = 1; }
        }
        stdout += stdin; lastCode = code;
      }
      return result(stdout, lastCode, stderr);
    },
    complete(raw) {
      const match = raw.match(/(?:^|[\s|;&])([^\s|;&]*)$/); if (!match) return { value: raw, matches: [] };
      const token = match[1], prefix = raw.slice(0, raw.length - token.length), commandPosition = !prefix.trim() || /[|;&]\s*$/.test(prefix); let matches = [];
      if (commandPosition && !token.includes('/')) matches = Object.keys(commands).filter(name => isAvailable(name) && name.startsWith(token)).sort();
      else { const slash = token.lastIndexOf('/'), directory = slash < 0 ? '' : token.slice(0, slash + 1), partial = token.slice(slash + 1), node = system.getNode(path(directory || '.')); if (node?.type === 'dir') { try { checkDirectory(path(directory || '.')); } catch { return { value: raw, matches: [] }; } matches = Object.keys(node.children).filter(name => name.startsWith(partial) && (partial.startsWith('.') || !name.startsWith('.'))).sort().map(name => directory + name + (node.children[name].type === 'dir' ? '/' : '')); } }
      if (!matches.length) return { value: raw, matches };
      let common = matches[0]; for (const candidate of matches.slice(1)) while (!candidate.startsWith(common)) common = common.slice(0, -1);
      const escaped = common.replace(/([\s'"\\;&|<>$])/g, '\\$1'); return { value: prefix + escaped + (matches.length === 1 && !common.endsWith('/') ? ' ' : ''), matches };
    }
  };
}
function unescapeText(text) { return text.replace(/\\([ntr\\])/g, (_, code) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\' })[code]); }
function expandRange(text) { return text.replace(/(.)-(.)/g, (_, from, to) => { const start = from.codePointAt(0), end = to.codePointAt(0); if (end < start || end - start > 256) throw new Error('tr: ogiltigt teckenintervall'); return Array.from({ length: end - start + 1 }, (_, i) => String.fromCodePoint(start + i)).join(''); }); }
function selectIndices(spec, length) { const indices = new Set(); for (const part of spec.split(',')) { const match = part.match(/^(\d+)(?:-(\d*))?$/); if (!match) throw new Error('cut: ogiltigt intervall'); const start = Number(match[1]), end = part.includes('-') ? Number(match[2] || length) : start; if (start < 1 || end < start) throw new Error('cut: ogiltigt intervall'); for (let i = start; i <= Math.min(end, length); i++) indices.add(i - 1); } return [...indices].sort((a, b) => a - b); }
function figlet(text) {
  const font = { A:'01110/10001/11111/10001/10001', B:'11110/10001/11110/10001/11110', C:'01111/10000/10000/10000/01111', D:'11110/10001/10001/10001/11110', E:'11111/10000/11110/10000/11111', F:'11111/10000/11110/10000/10000', G:'01111/10000/10111/10001/01111', H:'10001/10001/11111/10001/10001', I:'111/010/010/010/111', J:'00111/00010/00010/10010/01100', K:'10001/10010/11100/10010/10001', L:'10000/10000/10000/10000/11111', M:'10001/11011/10101/10001/10001', N:'10001/11001/10101/10011/10001', O:'01110/10001/10001/10001/01110', P:'11110/10001/11110/10000/10000', Q:'01110/10001/10101/10010/01101', R:'11110/10001/11110/10010/10001', S:'01111/10000/01110/00001/11110', T:'11111/00100/00100/00100/00100', U:'10001/10001/10001/10001/01110', V:'10001/10001/10001/01010/00100', W:'10001/10001/10101/11011/10001', X:'10001/01010/00100/01010/10001', Y:'10001/01010/00100/00100/00100', Z:'11111/00010/00100/01000/11111', '0':'01110/10011/10101/11001/01110', '1':'010/110/010/010/111', '2':'11110/00001/01110/10000/11111', '3':'11110/00001/01110/00001/11110', '4':'10010/10010/11111/00010/00010', '5':'11111/10000/11110/00001/11110', '6':'01111/10000/11110/10001/01110', '7':'11111/00001/00010/00100/00100', '8':'01110/10001/01110/10001/01110', '9':'01110/10001/01111/00001/11110', ' ':'000/000/000/000/000', '!':'1/1/1/0/1', '?':'1110/0001/0110/0000/0100' };
  const chars = [...text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().slice(0, 60)].map(char => (font[char] || font['?']).split('/'));
  return Array.from({ length: 5 }, (_, i) => chars.map(char => char[i].replaceAll('1', '█').replaceAll('0', ' ')).join(' ')).join('\n') + '\n';
}
export function createTerminalRenderer({ system, PACKAGE_REGISTRY = DEFAULT_REGISTRY, toast = () => {}, openApp, renderLauncherApps = () => {} }) {
  return function renderTerminal(root, options = {}, terminalWindow) {
    root.innerHTML = '<div class="terminal"><div class="terminal-output" role="log" aria-live="polite"><span class="success">flinux 1.0 Glimten</span> — Det glada linuxet\nSkriv <span class="directory">help</span> för hjälp. Tab kompletterar, ↑/↓ visar historik.\n\n</div><form class="terminal-line"><span class="prompt"></span><input class="terminal-input" aria-label="Terminalkommando" autocomplete="off" autocapitalize="off" spellcheck="false"></form></div>';
    const terminal = root.firstElementChild, output = terminal.querySelector('.terminal-output'), form = terminal.querySelector('form'), input = form.querySelector('input'), prompt = form.querySelector('.prompt');
    let position = 0, draft = '', reader = null;
    const print = (text, className = '') => { if (!text) return; const span = document.createElement('span'); span.className = className; span.textContent = text; output.append(span); while (output.childNodes.length > 1200) output.firstChild.remove(); terminal.scrollTop = terminal.scrollHeight; };
    const closeReader = () => { reader?.remove(); reader = null; form.hidden = false; output.hidden = false; input.focus(); };
    const shell = createShellSession({ system, PACKAGE_REGISTRY, openApp, cwd: options.cwd || options.path || system.state.user.home, onClear: () => { output.textContent = ''; }, onExit: () => terminalWindow?.querySelector('[data-action="close"]')?.click(), onRead: (text, title) => {
      reader = document.createElement('div'); reader.className = 'terminal-reader'; reader.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0';
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;justify-content:space-between;padding:8px;background:#21322f'; const label = document.createElement('span'); label.textContent = `${title} · q stänger`; const close = document.createElement('button'); close.textContent = 'Stäng'; close.onclick = closeReader; bar.append(label, close);
      const content = document.createElement('pre'); content.textContent = text; content.tabIndex = 0; content.style.cssText = 'overflow:auto;white-space:pre-wrap;flex:1;margin:0;padding:12px'; content.onkeydown = event => { if (['q', 'Escape'].includes(event.key)) { event.preventDefault(); closeReader(); } }; reader.append(bar, content); output.hidden = true; form.hidden = true; terminal.append(reader); content.focus();
    } });
    const updatePrompt = () => { prompt.textContent = shell.prompt; };
    form.onsubmit = event => { event.preventDefault(); const raw = input.value; if (!raw.trim()) return; print(`${shell.prompt} ${raw}\n`, 'terminal-command'); input.value = ''; draft = ''; const response = shell.execute(raw); print(response.stdout); print(response.stderr, 'error'); position = shell.history.length; updatePrompt(); renderLauncherApps(); if (system.storageError) toast(system.storageError); };
    input.onkeydown = event => {
      if (event.ctrlKey && event.altKey) return;
      const history = shell.history;
      if (event.key === 'ArrowUp') { event.preventDefault(); if (position === history.length) draft = input.value; position = Math.max(0, position - 1); input.value = history[position] || ''; }
      else if (event.key === 'ArrowDown') { event.preventDefault(); position = Math.min(history.length, position + 1); input.value = history[position] ?? draft; }
      else if (event.key === 'Tab') { event.preventDefault(); const completed = shell.complete(input.value); if (completed.matches.length > 1 && completed.value === input.value) print(completed.matches.join('  ') + '\n'); input.value = completed.value; }
      else if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); output.textContent = ''; }
      else if (event.ctrlKey && event.key.toLowerCase() === 'c' && !globalThis.getSelection()?.toString()) { event.preventDefault(); print(`${shell.prompt} ${input.value}^C\n`); input.value = ''; position = history.length; }
    };
    terminal.addEventListener('click', event => { if (!reader && !globalThis.getSelection()?.toString() && !event.target.closest('button')) input.focus(); });
    updatePrompt(); setTimeout(() => input.focus(), 0);
  };
}

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, appendFileSync } from 'node:fs';

const outFile = process.argv[2] || 'transcript.jsonl';
writeFileSync(outFile, '');

const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });

const rl = createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();

function log(direction, obj) {
  const line = JSON.stringify({ direction, ts: new Date().toISOString(), ...obj });
  appendFileSync(outFile, line + '\n');
  console.log(direction, JSON.stringify(obj).slice(0, 300));
}

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  log('send', msg);
  child.stdin.write(JSON.stringify(msg) + '\n');
  return id;
}

function sendNotification(method, params) {
  const msg = { jsonrpc: '2.0', method, params };
  log('send', msg);
  child.stdin.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const obj = JSON.parse(line);
    log('recv', obj);
  } catch (e) {
    log('recv-raw', { raw: line });
  }
});

child.stderr.on('data', (d) => {
  appendFileSync(outFile, JSON.stringify({ direction: 'stderr', ts: new Date().toISOString(), text: d.toString() }) + '\n');
  console.error('STDERR', d.toString());
});

child.on('exit', (code, sig) => {
  console.log('child exited', code, sig);
});

// Sequence of calls to run
async function main() {
  send('initialize', { clientInfo: { name: 'openbot-spike', title: 'OpenBot Engine Spike', version: '0.0.1' }, capabilities: { experimentalApi: true } });
  await new Promise(r => setTimeout(r, 500));
  sendNotification('initialized', {});
  await new Promise(r => setTimeout(r, 300));
  send('thread/start', { cwd: process.cwd() });
  await new Promise(r => setTimeout(r, 1500));
  // Try listing mcp server status (no thread needed)
  send('mcpServerStatus/list', {});
  await new Promise(r => setTimeout(r, 1500));
  child.kill();
  process.exit(0);
}

main();

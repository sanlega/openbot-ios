import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, appendFileSync } from 'node:fs';

const outFile = process.argv[2] || 'transcript.jsonl';
writeFileSync(outFile, '');

const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });

const rl = createInterface({ input: child.stdout });
let nextId = 1;
let threadId = null;
let turnStarted = false;

function log(direction, obj) {
  const line = JSON.stringify({ direction, ts: new Date().toISOString(), ...obj });
  appendFileSync(outFile, line + '\n');
  console.log(direction, JSON.stringify(obj).slice(0, 500));
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
function sendResponse(id, result) {
  const msg = { jsonrpc: '2.0', id, result };
  log('send', msg);
  child.stdin.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let obj;
  try { obj = JSON.parse(line); } catch (e) { log('recv-raw', { raw: line }); return; }
  log('recv', obj);
  if (obj.id === 2 && obj.result && obj.result.thread) {
    threadId = obj.result.thread.id;
    console.log('*** captured threadId', threadId);
    send('turn/start', { threadId, input: [{ type: 'text', text: 'Say hello in one word.' }] });
    turnStarted = true;
  }
  if (obj.method && obj.id !== undefined && obj.params && obj.method.includes('requestApproval')) {
    sendResponse(obj.id, { decision: 'denied' });
  }
});

child.stderr.on('data', (d) => {
  appendFileSync(outFile, JSON.stringify({ direction: 'stderr', ts: new Date().toISOString(), text: d.toString() }) + '\n');
  console.error('STDERR', d.toString().slice(0,300));
});
child.on('exit', (code, sig) => console.log('child exited', code, sig));

async function main() {
  send('initialize', { clientInfo: { name: 'openbot-spike', version: '0.0.1' }, capabilities: { experimentalApi: true } });
  await new Promise(r => setTimeout(r, 500));
  sendNotification('initialized', {});
  await new Promise(r => setTimeout(r, 300));
  send('thread/start', { cwd: process.cwd(), sandbox: 'workspace-write', approvalPolicy: 'on-request' });
  await new Promise(r => setTimeout(r, 6000));
  child.kill();
  setTimeout(() => process.exit(0), 300);
}
main();

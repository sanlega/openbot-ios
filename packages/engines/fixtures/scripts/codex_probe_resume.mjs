import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, appendFileSync } from 'node:fs';

const outFile = process.argv[2] || 'transcript.jsonl';
const threadIdToResume = process.argv[3];
writeFileSync(outFile, '');
const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
const rl = createInterface({ input: child.stdout });
let nextId = 1;
function log(direction, obj) {
  const line = JSON.stringify({ direction, ts: new Date().toISOString(), ...obj });
  appendFileSync(outFile, line + '\n');
  console.log(direction, JSON.stringify(obj).slice(0, 400));
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
  try { log('recv', JSON.parse(line)); } catch (e) { log('recv-raw', { raw: line }); }
});
child.stderr.on('data', (d) => {
  appendFileSync(outFile, JSON.stringify({ direction: 'stderr', ts: new Date().toISOString(), text: d.toString() }) + '\n');
});
child.on('exit', (code, sig) => console.log('child exited', code, sig));

async function main() {
  send('initialize', { clientInfo: { name: 'openbot-spike', version: '0.0.1' } });
  await new Promise(r => setTimeout(r, 400));
  sendNotification('initialized', {});
  await new Promise(r => setTimeout(r, 200));
  send('thread/resume', { threadId: threadIdToResume });
  await new Promise(r => setTimeout(r, 1500));
  child.kill();
  setTimeout(() => process.exit(0), 300);
}
main();

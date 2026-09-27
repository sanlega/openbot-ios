import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, appendFileSync } from 'node:fs';
const outFile = process.argv[2] || 'transcript.jsonl';
writeFileSync(outFile, '');
const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
const rl = createInterface({ input: child.stdout });
let nextId = 1;
let threadId = null;
function log(direction, obj) {
  const line = JSON.stringify({ direction, ts: new Date().toISOString(), ...obj });
  appendFileSync(outFile, line + '\n');
  console.log(direction, JSON.stringify(obj).slice(0, 600));
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
  let obj; try { obj = JSON.parse(line); } catch (e) { log('recv-raw', { raw: line }); return; }
  log('recv', obj);
  if (obj.id === 2 && obj.result && obj.result.thread) threadId = obj.result.thread.id;
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
  send('thread/start', {
    cwd: process.cwd(),
    config: { mcp_servers: { openbot_per_thread: { command: 'node', args: ['/agent/internal-work/mcp-openbot-stub.mjs'] } } }
  });
  await new Promise(r => setTimeout(r, 1500));
  send('mcpServerStatus/list', { threadId });
  await new Promise(r => setTimeout(r, 1500));
  // Start a SECOND thread with NO mcp servers configured, to prove isolation
  send('thread/start', { cwd: process.cwd() });
  await new Promise(r => setTimeout(r, 1000));
  child.kill();
  setTimeout(() => process.exit(0), 300);
}
main();

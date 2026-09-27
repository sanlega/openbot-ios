import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, appendFileSync } from 'node:fs';

const outFile = process.argv[2] || 'claude-transcript.jsonl';
writeFileSync(outFile, '');

const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--replay-user-messages'];
const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });

function log(direction, obj) {
  const line = JSON.stringify({ direction, ts: new Date().toISOString(), ...obj });
  appendFileSync(outFile, line + '\n');
  console.log(direction, JSON.stringify(obj).slice(0, 400));
}

const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try { log('recv', JSON.parse(line)); } catch (e) { log('recv-raw', { raw: line }); }
});
child.stderr.on('data', (d) => {
  appendFileSync(outFile, JSON.stringify({ direction: 'stderr', ts: new Date().toISOString(), text: d.toString() }) + '\n');
  console.error('STDERR', d.toString().slice(0, 300));
});
child.on('exit', (code, sig) => console.log('*** child exited', code, sig, '(process is long-lived if this happens only after we close stdin, not after first turn)'));

function sendUserMessage(text) {
  const msg = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
  log('send', msg);
  child.stdin.write(JSON.stringify(msg) + '\n');
}

async function main() {
  sendUserMessage('First message: say A.');
  await new Promise(r => setTimeout(r, 3000));
  console.log('*** process still alive after first turn?', !child.killed, 'pid', child.pid);
  sendUserMessage('Second message: say B.');
  await new Promise(r => setTimeout(r, 3000));
  console.log('*** closing stdin now to end the long-lived process');
  child.stdin.end();
  await new Promise(r => setTimeout(r, 2000));
  if (!child.killed) child.kill();
  setTimeout(() => process.exit(0), 300);
}
main();

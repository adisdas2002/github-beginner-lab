// Stands in for the `claude` CLI in tests: prints stream-json like `claude -p`.
// The test runner also loads every file under test/, so do nothing unless a
// test launched this on purpose.
if (process.env.FAKE_CLAUDE !== '1') process.exit(0);
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const model = args[args.indexOf('--model') + 1];
  if (process.env.FAKE_CLAUDE_MODE === 'auth-error') {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    process.exit(1);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    out({ type: 'result', is_error: true, result: 'leaked api key' });
    process.exit(1);
  }
  out({ type: 'system', subtype: 'init', model });
  out({ type: 'stream_event', event: { type: 'message_start', message: { model } } });
  const reply = `Heard ${input.length} chars; tools=${JSON.stringify(args[args.indexOf('--tools') + 1])}; effort=${args.includes('--effort') ? args[args.indexOf('--effort') + 1] : 'none'}.`;
  for (const piece of reply.match(/.{1,7}/g)) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } });
  }
  out({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } });
  out({ type: 'result', subtype: 'success', is_error: false, result: reply, usage: { input_tokens: 12, output_tokens: 7 } });
});

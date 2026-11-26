const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const readHistory = require('../skills/handoff/scripts/read-history.cjs');

const workspaceScript = path.resolve(__dirname, '../skills/handoff/scripts/workspace.cjs');
const source = { threadId: 'example-chat', hostId: 'local' };

function userMessage(id, text) {
  return { type: 'userMessage', id, content: [{ type: 'text', text }] };
}

test('recovers a correction across both pagination levels and keeps its source pointer', async () => {
  const earlier = userMessage('request', 'Create a report.');
  earlier.content.push({ type: 'image', url: 'attachment-payload' });
  const correction = userMessage('correction', 'Keep input order.');
  const pages = {
    latest: {
      thread: { id: source.threadId },
      page: { order: 'newest_first', hasMore: true, nextCursor: 'earlier-turn' },
      turns: [{ id: 't2', nextItemCursor: 'earlier-item', items: [
        { type: 'agentMessage', id: 'ack', text: 'Understood.' }
      ] }]
    },
    'earlier-item': { items: [correction, { type: 'commandExecution', output: 'command-payload' }] },
    'earlier-turn': { page: { hasMore: false }, turns: [{ id: 't1', items: [earlier] }] }
  };
  const history = await readHistory(async request => {
    assert.equal(request.includeOutputs, false);
    assert.equal(request.threadId, source.threadId);
    assert.ok(!(request.cursor && request.itemCursor));
    return { structuredContent: pages[request.itemCursor ?? request.cursor ?? 'latest'] };
  }, source);

  assert.deepEqual(history.messages.map(message => message.item), ['request', 'correction', 'ack']);
  assert.equal(history.messages[0].checkOriginal, true);
  assert.deepEqual(history.pages[history.messages[1].page], { itemCursor: 'earlier-item' });
  assert.doesNotMatch(JSON.stringify(history), /attachment-payload|command-payload/);
});

test('reports an incomplete turn page', async () => {
  const incomplete = { structuredContent: { turns: [], page: { hasMore: true } } };
  await assert.rejects(readHistory(async () => incomplete, source), /Incomplete turn history/);
});

function temporaryDirectory(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(parent, 'codex-handoff-test-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync.native(dir)), parent);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function run(command, args, expectedStatus = 0) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, expectedStatus, result.stderr + result.stdout);
  return result.stdout;
}

function check(manifest, root, status = 0) {
  return JSON.parse(run(process.execPath, [workspaceScript, 'check', manifest, root], status));
}

test('checks a dirty Git tree read-only and detects staged-only and untracked input changes', t => {
  const temp = temporaryDirectory(t);
  const root = path.join(temp, '工程 A');
  const manifest = path.join(temp, 'workspace.json');
  fs.mkdirSync(root);
  const git = (...args) => run('git', ['--no-optional-locks', '-C', root, ...args]);
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  const tracked = path.join(root, 'labels.txt');
  const input = path.join(root, 'sample input.txt');
  fs.writeFileSync(tracked, 'staged\n');
  git('add', 'labels.txt');
  fs.writeFileSync(tracked, 'working\n');
  fs.writeFileSync(input, 'one');

  const before = git('status', '--porcelain=v1', '-z');
  run(process.execPath, [workspaceScript, 'capture', manifest, root, tracked, input]);
  assert.equal(check(manifest, root).match, true);
  assert.equal(git('status', '--porcelain=v1', '-z'), before);
  fs.writeFileSync(input, 'two');
  assert.deepEqual(check(manifest, root, 1).changedFiles, [input]);
  fs.writeFileSync(input, 'one');
  fs.writeFileSync(tracked, 'new index\n');
  git('add', 'labels.txt');
  fs.writeFileSync(tracked, 'working\n');
  const changed = check(manifest, root, 1);
  assert.deepEqual(changed.gitFields, ['stagedSha256']);
  assert.deepEqual(changed.changedFiles, []);
});

test('checks a plain directory, detects the wrong root and preserves a prior manifest', t => {
  const temp = temporaryDirectory(t);
  const root = path.join(temp, 'plain');
  fs.mkdirSync(root);
  const manifest = path.join(temp, 'workspace.json');
  const args = [workspaceScript, 'capture', manifest, root, 'pending.txt'];
  run(process.execPath, args);
  const before = fs.readFileSync(manifest);
  assert.equal(check(manifest, root).match, true);
  assert.equal(check(manifest, temp, 1).match, false);
  fs.writeFileSync(path.join(root, 'pending.txt'), 'now present');
  assert.deepEqual(check(manifest, root, 1).changedFiles, [path.join(root, 'pending.txt')]);
  run(process.execPath, args, 2);
  assert.deepEqual(fs.readFileSync(manifest), before);
});

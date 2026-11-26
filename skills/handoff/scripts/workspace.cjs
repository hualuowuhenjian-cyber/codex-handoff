const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function gitState(root) {
  function git(args) {
    const run = spawnSync('git', ['--no-optional-locks', '-C', root, ...args], {
      env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 64 * 1024 * 1024, windowsHide: true
    });
    if (run.error && run.error.code !== 'ENOENT') throw run.error;
    return run;
  }
  function value(args, nullable = false) {
    const result = git(args);
    if (result.status === 0) return result.stdout;
    if (nullable && result.status === 1) return null;
    throw new Error(result.stderr?.toString().trim() || `git ${args[0]} failed`);
  }
  const probe = git(['rev-parse', '--show-toplevel']);
  if (probe.error?.code === 'ENOENT') return { state: 'git-unavailable' };
  if (probe.status !== 0) {
    if (probe.stderr.toString().includes('not a git repository')) return { state: 'no-repository' };
    throw new Error(probe.stderr.toString().trim());
  }
  const top = fs.realpathSync.native(probe.stdout.toString().trimEnd());
  const entries = value(['status', '--porcelain=v1', '-z', '--untracked-files=normal']).toString().split('\0');
  entries.pop();
  const staged = value(['diff', '--cached', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--', ':/']);
  return {
    state: 'repository', top,
    branch: value(['symbolic-ref', '-q', '--short', 'HEAD'], true)?.toString().trimEnd() ?? null,
    head: value(['rev-parse', '--verify', '-q', 'HEAD'], true)?.toString().trimEnd() ?? null,
    status: entries, stagedSha256: crypto.createHash('sha256').update(staged).digest('hex')
  };
}

async function fileState(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return { path: file, state: 'missing' };
    throw error;
  }
  if (stat.isSymbolicLink()) return { path: file, state: 'symlink', target: fs.readlinkSync(file) };
  if (!stat.isFile()) throw new Error(`Select a specific file inside ${file}`);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return { path: file, state: 'file', sha256: hash.digest('hex') };
}

async function snapshot(directory, files) {
  const root = fs.realpathSync.native(directory);
  const selected = [...new Set(files.map(file => path.resolve(root, file)))];
  const anchors = [];
  for (const file of selected) anchors.push(await fileState(file));
  return { version: 1, root, git: gitState(root), files: anchors };
}

async function main() {
  const [action, manifestPath, directory, ...files] = process.argv.slice(2);
  if (!['capture', 'check'].includes(action) || !manifestPath || !directory || (action === 'check' && files.length)) {
    throw new Error('Usage: workspace.cjs capture MANIFEST ROOT [FILE ...] | check MANIFEST ROOT');
  }
  if (action === 'capture') {
    const state = await snapshot(directory, files);
    fs.writeFileSync(manifestPath, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ root: state.root, git: state.git.state, files: state.files.length }));
    return;
  }
  const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  if (saved.version !== 1) throw new Error('Unsupported workspace manifest');
  const root = fs.realpathSync.native(directory);
  if (root !== saved.root) {
    console.log(JSON.stringify({ match: false, expectedRoot: saved.root, actualRoot: root }));
    process.exitCode = 1;
    return;
  }
  const current = await snapshot(root, saved.files.map(file => file.path));
  const differs = (left, right) => JSON.stringify(left) !== JSON.stringify(right);
  const gitFields = Object.keys(saved.git).filter(key => differs(saved.git[key], current.git[key]));
  const changedFiles = saved.files.filter((file, index) => differs(file, current.files[index])).map(file => file.path);
  const match = !gitFields.length && !changedFiles.length;
  console.log(JSON.stringify({ match, root, gitFields, changedFiles }));
  if (!match) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 2; });

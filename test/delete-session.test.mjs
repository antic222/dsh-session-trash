import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { deleteStoredSession } from '../lib/delete-session.js'

const SESSION = 'session-11111111-2222-3333-4444-555555555555'

/** Build one throwaway Harness home with a stored Session and its cache shard. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'session-trash-'))
  const dir = join(root, 'sessions', '--proj--', SESSION)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'log')
  await writeFile(join(dir, 'session.lock'), '')
  const cacheDir = join(root, 'storages', 'session_projcache', 'sessions')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, `${SESSION}.json`), '{}')

  const calls = []
  const workspace = {
    sessionIds: [SESSION],
    async detachSession(id) {
      calls.push(['detach', id])
    },
  }
  const registry = {
    list: () => [workspace],
    async unarchiveSession(id) {
      calls.push(['unarchive', id])
    },
    async unpinSession(id) {
      calls.push(['unpin', id])
    },
  }
  const persistence = {
    async list() {
      return [{ header: { id: SESSION, cwd: '/tmp/proj' } }]
    },
    locate(header) {
      return { kind: 'jsonl', path: join(root, 'sessions', '--proj--', header.id, 'session.v4.jsonl.zstd') }
    },
  }
  return {
    root,
    dir,
    cache: join(cacheDir, `${SESSION}.json`),
    calls,
    registry,
    persistence,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

test('deletes the artifact, the accounting and the cache shard', async () => {
  const f = await fixture()
  try {
    const result = await deleteStoredSession({
      sessions: { get: () => undefined },
      sessionPersistence: f.persistence,
      workspaceRegistry: f.registry,
      homeDir: f.root,
    }, SESSION)

    assert.deepEqual(result, { ok: true, sessionId: SESSION })
    await assert.rejects(stat(f.dir), { code: 'ENOENT' })
    await assert.rejects(readFile(f.cache), { code: 'ENOENT' })
    assert.deepEqual(f.calls, [
      ['detach', SESSION],
      ['unarchive', SESSION],
      ['unpin', SESSION],
    ])
  } finally {
    await f.cleanup()
  }
})

test('refuses a live Session when the Host exposes no release step', async () => {
  const f = await fixture()
  try {
    const result = await deleteStoredSession({
      sessions: { get: (id) => (id === SESSION ? { id } : undefined) },
      sessionPersistence: f.persistence,
      workspaceRegistry: f.registry,
      homeDir: f.root,
    }, SESSION)

    assert.deepEqual(result, { ok: false, code: 'open' })
    assert.equal((await stat(f.dir)).isDirectory(), true)
    assert.deepEqual(f.calls, [])
  } finally {
    await f.cleanup()
  }
})

test('refuses a live Session whose work is running', async () => {
  const f = await fixture()
  try {
    const result = await deleteStoredSession({
      sessions: { get: (id) => (id === SESSION ? { id } : undefined) },
      sessionPersistence: f.persistence,
      workspaceRegistry: f.registry,
      checkLive: async () => ({ ok: false, code: 'active' }),
      homeDir: f.root,
    }, SESSION)

    assert.deepEqual(result, { ok: false, code: 'active' })
    assert.equal((await stat(f.dir)).isDirectory(), true)
    assert.deepEqual(f.calls, [])
  } finally {
    await f.cleanup()
  }
})

test('releases an idle live Session after its files are gone', async () => {
  const f = await fixture()
  try {
    let artifactAtRelease = 'not-called'
    const result = await deleteStoredSession({
      sessions: { get: (id) => (id === SESSION ? { id } : undefined) },
      sessionPersistence: f.persistence,
      workspaceRegistry: f.registry,
      checkLive: async () => ({
        ok: true,
        detach: async () => {
          artifactAtRelease = await stat(f.dir).then(() => 'exists', () => 'gone')
        },
      }),
      homeDir: f.root,
    }, SESSION)

    assert.equal(result.ok, true)
    assert.equal(artifactAtRelease, 'gone')
    await assert.rejects(stat(f.dir), { code: 'ENOENT' })
    assert.deepEqual(f.calls, [
      ['detach', SESSION],
      ['unarchive', SESSION],
      ['unpin', SESSION],
    ])
  } finally {
    await f.cleanup()
  }
})

test('reports a Session that is already gone', async () => {
  const f = await fixture()
  try {
    const result = await deleteStoredSession({
      sessions: { get: () => undefined },
      sessionPersistence: { list: async () => [], locate: f.persistence.locate },
      workspaceRegistry: f.registry,
      homeDir: f.root,
    }, SESSION)

    assert.deepEqual(result, { ok: false, code: 'missing' })
    assert.equal((await stat(f.dir)).isDirectory(), true)
  } finally {
    await f.cleanup()
  }
})

test('rejects an id it did not mint', async () => {
  const f = await fixture()
  try {
    const result = await deleteStoredSession({
      sessions: { get: () => undefined },
      sessionPersistence: f.persistence,
      workspaceRegistry: f.registry,
      homeDir: f.root,
    }, '../../etc')

    assert.deepEqual(result, { ok: false, code: 'invalid' })
  } finally {
    await f.cleanup()
  }
})

test('refuses an artifact path that is not the Session directory', async () => {
  const f = await fixture()
  try {
    const persistence = {
      list: f.persistence.list,
      locate: () => ({ kind: 'jsonl', path: join(f.root, 'elsewhere', 'log') }),
    }
    await assert.rejects(deleteStoredSession({
      sessions: { get: () => undefined },
      sessionPersistence: persistence,
      workspaceRegistry: f.registry,
      homeDir: f.root,
    }, SESSION), /refusing to delete/)
    assert.equal((await stat(f.dir)).isDirectory(), true)
  } finally {
    await f.cleanup()
  }
})

test('registry cleanup failure does not fail the deletion', async () => {
  const f = await fixture()
  try {
    const registry = {
      list() {
        throw new Error('registry read failed')
      },
      async unarchiveSession() {},
      async unpinSession() {},
    }
    const warnings = []
    const result = await deleteStoredSession({
      sessions: { get: () => undefined },
      sessionPersistence: f.persistence,
      workspaceRegistry: registry,
      homeDir: f.root,
      logger: { warn: (message) => warnings.push(message) },
    }, SESSION)

    assert.equal(result.ok, true)
    await assert.rejects(stat(f.dir), { code: 'ENOENT' })
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /workspace accounting cleanup failed/)
  } finally {
    await f.cleanup()
  }
})

/**
 * The one destructive operation of this bundle: remove one stored Session.
 *
 * The Session artifact directory is deleted first (that is the irreversible
 * step), then the Workspace registry accounting and the projection-cache
 * shard are cleaned up best-effort. Every public entry point returns
 * `{ ok: false, code }` for an expected refusal and throws only for a real
 * filesystem or backend failure.
 */
import { rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** Session ids minted by the persistence layer. */
const SESSION_ID = /^session-[A-Za-z0-9][A-Za-z0-9-]*$/

/**
 * Resolve the Harness home the same way the rest of the Host does.
 * @param env - process environment carrying an optional `DSH_HOME`.
 * @returns the absolute Harness home.
 */
export function resolveDshHome(env = process.env) {
  const configured = env.DSH_HOME?.trim()
  return configured ? configured : join(homedir(), '.dsh')
}

/**
 * Delete the stored Session named by `sessionId`.
 * @param deps - live Host services plus the Harness home and a logger.
 * @param deps.sessions - the Session store (`ctx.sessions`), used to release live Sessions.
 * @param deps.sessionPersistence - the stored-log backend (`ctx.sessionPersistence`).
 * @param deps.workspaceRegistry - the Workspace registry (`ctx.workspaceRegistry`).
 * @param deps.checkLive - async `(id) => ({ ok, code?, detach? })` verdict for a live
 *   Session: refuse when its work is running, otherwise hand back the release step.
 * @param deps.logger - optional logger for best-effort cleanup warnings.
 * @param deps.homeDir - optional Harness home override, for tests.
 * @param sessionId - the Session to delete.
 * @returns `{ ok: true }` after the artifact is gone, or `{ ok: false, code }`.
 */
export async function deleteStoredSession(deps, sessionId) {
  const { sessions, sessionPersistence, workspaceRegistry, logger } = deps
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return { ok: false, code: 'invalid' }

  // A Session stays live in the Host after the browser switches away, so a live
  // one is deletable unless its work is running. The release step (removing it
  // from the Host session store) runs only after the files are gone.
  let detach = null
  if (sessions?.get(sessionId) !== undefined) {
    if (typeof deps.checkLive !== 'function') return { ok: false, code: 'open' }
    const verdict = await deps.checkLive(sessionId)
    if (verdict?.ok !== true) return { ok: false, code: verdict?.code ?? 'open' }
    if (typeof verdict.detach === 'function') detach = verdict.detach
  }
  if (sessionPersistence === undefined) throw new Error('session persistence is unavailable')
  if (typeof sessionPersistence.locate !== 'function') {
    throw new Error('this deployment does not expose session artifact locations')
  }

  const snapshots = await sessionPersistence.list()
  const snapshot = snapshots.find((candidate) => candidate.header?.id === sessionId)
  if (snapshot === undefined) return { ok: false, code: 'missing' }

  const located = sessionPersistence.locate(snapshot.header)
  const directory = dirname(located.path)
  if (basename(directory) !== sessionId) {
    throw new Error(`refusing to delete a directory that is not the Session's own: ${directory}`)
  }

  await rm(directory, { recursive: true, force: true })

  const warnings = []
  await cleanupWorkspaceRegistry(workspaceRegistry, sessionId, warnings)
  if (detach !== null) {
    try {
      await detach()
    } catch (error) {
      warnings.push(`host session release failed: ${messageOf(error)}`)
    }
  }
  await cleanupProjectionCache(join(deps.homeDir ?? resolveDshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`), warnings)
  for (const warning of warnings) logger?.warn?.(`session-trash: ${warning}`)

  return { ok: true, sessionId }
}

/**
 * Drop the Session from every Workspace account and from the global archive
 * and pin sets. Each write is best-effort: the artifact is already gone, so a
 * registry hiccup must not turn a successful deletion into a failure.
 * @param registry - the Workspace registry.
 * @param sessionId - the deleted Session.
 * @param warnings - collector for recoverable failures.
 */
async function cleanupWorkspaceRegistry(registry, sessionId, warnings) {
  if (registry === undefined) return
  try {
    for (const workspace of registry.list()) await workspace.detachSession(sessionId)
  } catch (error) {
    warnings.push(`workspace accounting cleanup failed: ${messageOf(error)}`)
  }
  for (const method of ['unarchiveSession', 'unpinSession']) {
    try {
      await registry[method](sessionId)
    } catch (error) {
      warnings.push(`${method} failed: ${messageOf(error)}`)
    }
  }
}

/**
 * Remove the Session's projection-cache shard. The cache is derived data; a
 * missing or unwritable shard never fails the deletion.
 * @param path - absolute cache shard path.
 * @param warnings - collector for recoverable failures.
 */
async function cleanupProjectionCache(path, warnings) {
  try {
    await rm(path, { force: true })
  } catch (error) {
    warnings.push(`projection cache cleanup failed: ${messageOf(error)}`)
  }
}

/** Render one unknown failure as a message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

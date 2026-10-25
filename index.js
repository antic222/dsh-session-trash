/**
 * Host half of the Session Trash bundle.
 *
 * Publishes one Client-callable Remote method — `sessionTrash/delete` — that
 * deletes a stored Session. The bundle deliberately imports nothing from the
 * `@deepseek-ai/*` scope: a profile-installed plugin cannot resolve the
 * installation's packages, so the service is registered through the Cordis
 * context itself and the Remote marker is declared directly (the same
 * prototype contract the `@Remote` decorator emits at build time).
 */
import { deleteStoredSession } from './lib/delete-session.js'

/** Cordis service key, which is also the Remote namespace. */
const SERVICE = 'sessionTrash'

/** Prototype key read by the Typert Gateway's source-mode discovery. */
const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Render one unknown failure as a message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Ask the same activity waterfall the built-in archive flow uses.
 * @param ctx - plugin context.
 * @param sessionId - the Session to inspect.
 * @returns the reported activity entries; empty when nothing is running.
 */
async function reportedActivity(ctx, sessionId) {
  try {
    const activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
    return Array.isArray(activity) ? activity : []
  } catch (error) {
    ctx.logger?.warn?.(`session-trash: activity check failed: ${messageOf(error)}`)
    return []
  }
}

/**
 * Decide whether a live Session may be deleted, and how to release it.
 *
 * A Session stays in the Host session store after the browser switches away,
 * so "live" alone is not a refusal: only running work is. When it is idle, the
 * returned `detach` removes the entry from the store (which emits
 * `session/disposed`, so the sidebar row disappears without a restart).
 * @param ctx - plugin context.
 * @param sessionId - the Session to inspect.
 * @returns `{ ok: true, detach? }` or `{ ok: false, code }`.
 */
async function checkLiveSession(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  if (sessions === undefined) return { ok: false, code: 'open' }
  const session = sessions.get(sessionId)
  if (session === undefined) return { ok: true }

  const activity = await reportedActivity(ctx, sessionId)
  if (activity.length > 0) return { ok: false, code: 'active' }

  if (typeof sessions.liveEntryFor !== 'function' || typeof sessions.detachEntered !== 'function') {
    return { ok: false, code: 'open' }
  }
  return {
    ok: true,
    detach: () => {
      const entry = sessions.liveEntryFor(session)
      if (entry !== undefined) sessions.detachEntered(entry)
    },
  }
}

/**
 * One destructive operation over stored Sessions.
 *
 * `ctx.reflect.provide` publishes this instance as the `sessionTrash` service,
 * and the frozen `typertRemote` field is the binding the Gateway validates
 * before dispatching a call.
 */
class SessionTrashService {
  /**
   * @param ctx - owning Cordis context.
   */
  constructor(ctx) {
    this.ctx = ctx
    this.typertRemote = Object.freeze({
      service: this,
      serviceKey: SERVICE,
      namespace: SERVICE,
    })
  }

  /**
   * Delete one stored Session and its accounting.
   * @param sessionId - the Session to delete.
   * @returns `{ ok: true }`, or `{ ok: false, code }` for an expected refusal.
   */
  async delete(sessionId) {
    return await deleteStoredSession({
      sessions: this.ctx.get('sessions'),
      sessionPersistence: this.ctx.get('sessionPersistence'),
      workspaceRegistry: this.ctx.get('workspaceRegistry'),
      checkLive: (id) => checkLiveSession(this.ctx, id),
      logger: this.ctx.logger,
    }, sessionId)
  }
}

Object.defineProperty(SessionTrashService.prototype, REMOTE_METHODS, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({
        method: 'delete',
        invocation: Object.freeze({ kind: 'direct' }),
      }),
    ]),
  }),
})

/**
 * Register the service with the owning fiber, so unloading the plugin removes it.
 * @param ctx - plugin context provided by the Loader.
 */
export function apply(ctx) {
  const service = new SessionTrashService(ctx)
  ctx.effect(() => ctx.reflect.provide(SERVICE, service), 'session-trash: service')
}

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

/**
 * Host half of the Session Trash bundle.
 *
 * It publishes one Client-callable Remote method — `sessionTrash/delete` —
 * that deletes a stored Session. The method marker below is the same runtime
 * contract `@Remote` emits at build time; this bundle is plain JavaScript
 * with no build step, so the marker is declared directly.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { deleteStoredSession } from './lib/delete-session.js'

/** Prototype key read by `@deepseek-ai/dsh-typert-protocol`'s `remoteMethods`. */
const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * The `sessionTrash` service: one destructive operation over stored Sessions.
 */
class SessionTrashService extends TypertRemoteService {
  /**
   * @param ctx - owning Cordis context.
   */
  constructor(ctx) {
    super(ctx, 'sessionTrash')
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

export default SessionTrashService

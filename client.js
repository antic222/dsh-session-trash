/**
 * Client half of the Session Trash bundle.
 *
 * Adds one `sidebar.workspaces.session.menu.item` row ("Delete session") and
 * the `shell.overlay` confirmation dialog it opens. The Host method is called
 * over the existing authenticated Connection carrier, so the bundle needs no
 * generated Typert descriptors of its own.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-trash',
  factory(require) {
    const React = require('react')
    const {
      Button,
      IconTrashOutlineRegular,
      MenuItemButton,
      Modal,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'session-trash'

    const zh = {
      'menu.delete': '删除会话',
      'delete.title': '删除这个对话？',
      'delete.description': '“{title}”及其全部消息将被永久删除，无法恢复。',
      'delete.cancel': '取消',
      'delete.confirm': '删除',
      'delete.pending': '正在删除…',
      'delete.close': '关闭',
      'error.open': '这个对话仍被宿主占用，暂时无法删除。',
      'error.active': '这个对话正在运行任务，等它停下来再删除。',
      'error.missing': '对话已不存在，可能已经被删除。',
      'error.invalid': '无法识别的对话。',
      'error.unknown': '删除失败。',
      'error.failed': '删除失败：{message}',
    }

    const en = {
      'menu.delete': 'Delete session',
      'delete.title': 'Delete this session?',
      'delete.description': '“{title}” and all of its messages will be deleted permanently. This cannot be undone.',
      'delete.cancel': 'Cancel',
      'delete.confirm': 'Delete',
      'delete.pending': 'Deleting…',
      'delete.close': 'Close',
      'error.open': 'This session is still held by the host and cannot be deleted right now.',
      'error.active': 'This session is running work. Wait for it to finish, then delete it.',
      'error.missing': 'The session no longer exists.',
      'error.invalid': 'Unrecognized session.',
      'error.unknown': 'The session could not be deleted.',
      'error.failed': 'Deleting failed: {message}',
    }

    /** A tiny snapshot store for the pending confirmation request. */
    function createPendingStore() {
      let value = null
      const listeners = new Set()
      return {
        get: () => value,
        set(next) {
          value = next
          for (const listener of listeners) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    /** Read the pending request with React's external-store contract. */
    function usePending(store) {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get)
    }

    /** The `...` menu row: raises the confirmation dialog. */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, requestDelete, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      return h(MenuItemButton, {
        icon: h(IconTrashOutlineRegular, { size: 14 }),
        onSelect: () => {
          setMenuOpen(false)
          requestDelete(sessionId, displayTitle)
        },
        children: t('menu.delete'),
      })
    }

    /** The overlay dialog: explains the loss, then calls the Host method. */
    function DeleteSessionDialog({ pending, runDelete, t }) {
      const request = usePending(pending)
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState(null)

      React.useEffect(() => {
        setBusy(false)
        setFailure(null)
      }, [request?.sessionId])

      if (request === null) return null

      const close = () => {
        if (!busy) pending.set(null)
      }

      const confirm = async () => {
        setBusy(true)
        setFailure(null)
        try {
          const value = await runDelete(request.sessionId)
          if (value?.ok === true) {
            pending.set(null)
            return
          }
          setFailure(messageFor(value?.code, t))
          setBusy(false)
        } catch (error) {
          setFailure(t('error.failed', { message: error instanceof Error ? error.message : String(error) }))
          setBusy(false)
        }
      }

      const title = request.title === undefined || request.title === '' ? request.sessionId : request.title

      return h(Modal, {
        open: true,
        onClose: close,
        closeLabel: t('delete.close'),
        title: t('delete.title'),
        description: t('delete.description', { title }),
        footer: [
          h(Button, {
            key: 'cancel',
            variant: 'outline',
            disabled: busy,
            onClick: close,
          }, t('delete.cancel')),
          h(Button, {
            key: 'confirm',
            variant: 'outline',
            disabled: busy,
            style: { color: 'var(--dsw-alias-state-error-primary)' },
            onClick: () => {
              confirm().catch(() => {})
            },
          }, busy ? t('delete.pending') : t('delete.confirm')),
        ],
        children: failure === null ? null : h('div', {
          role: 'alert',
          style: {
            color: 'var(--dsw-alias-state-error-primary)',
            fontSize: 12,
            lineHeight: '18px',
            marginTop: 8,
          },
        }, failure),
      })
    }

    /** Map a Host refusal code to a localized sentence. */
    function messageFor(code, t) {
      switch (code) {
        case 'active': return t('error.active')
        case 'open': return t('error.open')
        case 'missing': return t('error.missing')
        case 'invalid': return t('error.invalid')
        default: return t('error.unknown')
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const pending = createPendingStore()

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-trash: dictionaries')

        const requestDelete = (sessionId, title) => {
          pending.set({ sessionId, title })
        }

        const runDelete = async (sessionId) => {
          const connection = ctx.get('connection')
          if (connection === undefined) throw new Error('the connection service is unavailable')
          const result = await connection.rpc.call('/api', 'sessionTrash/delete', { args: { sessionId } })
          if (!result?.ok) throw new Error(result?.error?.message ?? 'the Host refused the call')
          if (result.value?.ok === true) {
            try {
              await ctx.get('sessions')?.refresh?.()
            } catch {
              /* the row disappears on the next list refresh */
            }
          }
          return result.value
        }

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'session-trash',
          order: 500,
          locale: NS,
          inject: () => ({ requestDelete }),
        }, DeleteSessionMenuItem))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-trash-confirm',
          locale: NS,
          inject: () => ({ pending, runDelete }),
        }, DeleteSessionDialog))
      },
    }
  },
})

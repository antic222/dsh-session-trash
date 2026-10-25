# @local/dsh-session-trash

给 Harness 侧栏的会话「⋯」菜单加一行 **删除会话**，确认后永久删除该对话的存储文件与登记信息。

## 安装

1. 克隆到本地任意目录：

   ```bash
   git clone https://github.com/antic222/dsh-session-trash
   ```

2. 打开 Harness → **设置 → 插件**（安装、启用和配置插件）。
3. 点 **安装第三方插件**，在输入框里填上面克隆出来的目录的**绝对路径**（例如 `/path/to/dsh-session-trash`）。
4. 安装完成后刷新页面（⌘R）。侧栏任意会话的「⋯」菜单最下面会多出「删除会话」。

> 必须填本地目录路径，不要填包名 `@local/dsh-session-trash`，否则 pnpm 会去 npm registry 找这个包。

## 行为

- 点击「删除会话」→ 弹出确认框，写明标题和「不可恢复」。
- 确认后宿主会：
  1. 删除该会话的存储目录（`~/.dsh/sessions/<项目>/session-<id>/`）；
  2. 把它从各工作区的会话列表、归档集合、置顶集合里移除；
  3. 从宿主会话表里摘掉（宿主的会话在切换后仍然常驻，不摘就会一直留在侧栏）；
  4. 尽力删除 `~/.dsh/storages/session_projcache/sessions/session-<id>.json` 缓存。
- 成功后会话从列表消失，不需要重启。

## 限制

- **正在跑任务的会话不能删**：会提示「这个对话正在运行任务，等它停下来再删除」。判断用的是官方归档同一套 `workspace/session-activity`，只要还有活动就不动。
- 打开过但已空闲的会话可以直接删；宿主里常驻的那条记录会一并摘掉。
- 删除不可恢复，没有回收站。
- 子会话（subagent）被删后，父会话里已存在的引用不会自动清理。
- 工作区目录、附件等其它数据不动。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | 宿主插件：注册 `sessionTrash` 服务，暴露 `sessionTrash/delete` 远程方法 |
| `lib/delete-session.js` | 删除逻辑（可直接用 node 测试） |
| `client.js` | 浏览器插件：菜单项 + 覆盖层确认框，经 `connection.rpc.call` 调宿主 |
| `cordis.patch.yml` | 把插件行插入 profile 的 loader 配置 |
| `test/delete-session.test.mjs` | 删除逻辑的单元测试 |

## 开发

```bash
node --test test/delete-session.test.mjs
```

宿主方法用运行时的 Typert 远程标记声明（等价于 `@Remote` 的编译产物），因此无需构建步骤。

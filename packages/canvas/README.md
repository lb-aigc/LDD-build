# @ldd/dsh-canvas

LDD 的画布插件：提供一块可视化的无限画布，用节点（图片/视频/音乐/文本/笔记）+ 连线组织素材，并且**与 agent 双向衔接** —— agent 通过 `canvas_*` 工具读画布、增删改节点、连关系线。

## 架构

- **Host 侧**（`src/index.ts`）：注册 `canvas_inspect` / `canvas_add_node` / `canvas_remove_node` / `canvas_update_node` / `canvas_link` 五个工具；画布状态**不存内存 Map**，而是每次 mutate 后向 session 追加一条 whole-value 的 `canvas/state` 事件，读的时候从 `snapshotEvents()` 折叠（`foldCanvas`）——所以 resume / fork 天然正确。再注册一个 `canvas` session projection（`stateVersion: 1`）作为客户端的读面。
- **Client 侧**（`src/client/`）：React Flow 画布，**同一份状态两个席位**：
  1. **右侧 Sidebar 的页类型 tab**（`kind: 'canvas'`）—— 走公开的两阶段注册（`ctx.sidebarRightTabs.register` + keyed `sidebar.right.pane.tab` 席位），和 `ui-sidebar-files` / `ui-sidebar-documentpreview` 同一条路径，**零 upstream patch**。刻意不注册 guide entry（否则 strip 的 `+` 会从「直接开文件」变成「开引导页」），入口是会话 header 里的常驻「画布」按钮（`conversation.session.header.utilities`）。
  2. **对话的视图 tab**（对话 / 轨迹 / 画布）—— 侧栏路线稳定前的退路，稳定后连同 `@deepseek-ai/dsh-client-ui-conversation` 的注入/peer 边一起删掉。
- **纯数据模型**（`src/model.ts`）：节点/连线类型 + 纯状态转移，双端共享、strip-only 可测（`tests/model.verify.ts`）。

两个席位都是 session 作用域，所以框架会自动把 `useProjection` / `sessionId` 交给画布组件；本插件自己注入的只有 `loadImage`（把 `sha256:` 图片节点通过 `session.readAttachment` 解析成 blob URL）。右侧栏的两个服务走 `ctx.inject` 而不是顶层 `inject`，这样在没有右侧栏的组合里画布仍然能工作。

## 现状（MVP）

只读呈现：agent 通过 `canvas_*` 工具改画布，用户可以平移 / 缩放 / 看小地图，但**不能拖拽节点、连线、改名或在界面上增删**——写回路径还没做。生成图自动落画布（`generate_*` → 节点）也还没做，目前由 agent 生成后手动调 `canvas_add_node`。

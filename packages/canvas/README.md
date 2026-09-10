# @ldd/dsh-canvas

LDD 的画布插件：在会话里提供一块可视化的无限画布，用节点（图片/视频/音乐/文本/笔记）+ 连线组织素材，并且**与 agent 双向衔接** —— agent 通过 `canvas_*` 工具读画布、增删改节点、连关系线。

## 架构

- **Host 侧**（`src/index.ts`）：注册 `canvas_inspect` / `canvas_add_node` / `canvas_remove_node` / `canvas_update_node` / `canvas_link` 五个工具，并维护按 SessionId 字符串键控的 `CanvasStore`。
- **Client 侧**（`src/client/`）：React Flow 画布，注册到 `conversation.view` slot（顶部多一个「画布」tab）。
- **纯数据模型**（`src/model.ts`）：节点/连线类型 + 纯状态转移，双端共享、strip-only 可测。

## 设计

- **Host 侧**（`src/index.ts`）：注册五个 `canvas_*` 工具；画布状态通过 `canvas/state` session 事件持久化，并由 `canvas` session projection 提供给客户端（`useProjection('canvas')`）。
- **Client 侧**（`src/client/`）：React Flow 画布，注册到 `conversation.view` slot（顶部多一个「画布」tab）。
- **纯数据模型**（`src/model.ts`）：节点/连线类型 + 纯状态转移，双端共享、strip-only 可测。

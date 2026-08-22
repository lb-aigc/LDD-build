# LDD 0.2.0 Harness 内核更新与多模态设计规格

**日期：** 2026-08-22  
**状态：** 待用户书面审阅  
**目标平台：** Windows 10/11 x64  
**桌面端版本：** LDD 0.2.0  
**首个验证内核：** DeepSeek Harness 0.1.1-rc.2

## 1. 本次更新的定义

LDD 仍然是 DeepSeek Harness Web UI 的 Windows 桌面封装，不在本次更新中改写为一套独立聊天界面。Electron 外壳负责安装、窗口、托盘、品牌、内核生命周期和更新；Harness 继续负责会话、模型、工具、Skills、插件和 Web UI。

本规格取代 2026-08-14 旧设计中“LDD 自建独立 React 会话界面”的相关部分。旧设计中的本地优先、安全 IPC、主题、品牌和 Windows 安装要求继续有效，但界面层以 Harness Web UI 为准。

这是最后一次必须通过重新发布 LDD 安装包才能获得内核更新能力的升级。安装 LDD 0.2.0 后，日常 Harness 升级由内核更新器完成；只有 Electron 外壳、更新器或其他 LDD 专属功能发生变化时，才重新发布新的 LDD 安装包。

## 2. 已确认的现状

- 当前安装包为 `LDD-Setup-0.1.0-x64-dsh-web(1).exe`。
- 当前桌面外壳版本为 0.1.0，内置 Harness 包版本为 0.1.0-rc.3。
- 当前外壳直接从 `app.asar.unpacked/node_modules` 启动内置 `dsh web`，没有内核版本目录、更新清单、在线安装、离线导入或回滚机制。
- 当前 DeepSeek 适配器声明纯文本输入并拒绝图片，修改上传大小本身不能启用 DeepSeek 视觉模型。
- 旧附件后端单张图片默认限制为 5 MiB，前端会在选择图片时按同一限制拦截；单消息最多 20 张、合计 100 MiB。
- 用户已提供官方 `deepseek-harness-master(1).zip`；包内所有 Harness 工作区版本均为 0.1.1-rc.2，源码压缩包 SHA-256 为 `47fb7e386c0bd86a6c4341321b8f2915cd6f490a687f8deaf78714e369e4c91d`。压缩包不含 `.git`，因此以该摘要和版本号作为本次源码快照身份。
- 仍未提供 LDD Electron 外壳的可编辑源码。可恢复的 Electron 编译产物保留了原始 TypeScript 模块边界，因此只重建 LDD 外壳；Harness 内核直接以用户提供的官方源码为准，不再从 EXE 反向恢复。

## 3. 更新范围

### 3.1 必须交付

1. 可维护的 LDD Electron 源码工程和可重复构建脚本。
2. 用户提供的官方 Harness 0.1.1-rc.2 源码快照、上游测试/build 记录和可重复的运行时打包脚本。
3. Harness 独立版本目录、启动选择、在线更新、离线导入、健康检查和自动回滚。
4. 首个验证内核 Harness 0.1.1-rc.2，启用 `deepseek-v4-flash-vision-exp`。
5. 图片上传策略：普通模式 20 MiB，高级模式 64 MiB，自动规范化并优先使用 DeepSeek Files API。
6. LDD 视频分析插件：本地抽帧后交给视觉模型，结构化结果再交还当前主模型。
7. 可访问插件中心并使用官方 `dsh plugin` 安装协议；第三方插件必须由用户明确确认后安装。
8. Windows 10/11 x64 安装包、离线 Harness 更新包格式和源码归档。
9. 现有 LDD/Harness 数据的安全迁移、备份和不破坏式升级。

### 3.2 本次不做

- 不重写 Harness Web UI。
- 不实现 LDD 账号、云同步、会员、商业插件市场或远程遥测。
- 不把 DeepSeek 视觉模型描述成原生视频模型；DeepSeek 视频分析必须经过本地抽帧。
- 不允许无限制图片或视频输入。
- 不实现静默、无确认的内核安装；检查和下载可以自动进行，切换内核需用户确认。
- 不把 macOS 作为本次发布阻塞项。

## 4. 总体架构

### 4.1 稳定外壳与可替换内核

LDD 0.2.0 分为三层：

1. **Electron 外壳**：安装在 LDD 程序目录，负责窗口、托盘、菜单、安全 IPC、更新器、日志和进程监督。
2. **运行时宿主**：固定随 LDD 安装的 Node.js 24 x64、pnpm 和 FFmpeg/ffprobe。Harness 的 `dsh plugin` 命令会把参数转交 pnpm，因此 pnpm 必须由 LDD 一并提供并加入 Harness 子进程的受控 `PATH`。这些宿主工具不随普通 Harness 更新替换，避免 Electron ABI 与 Node 原生依赖不兼容。
3. **Harness 内核版本**：安装在用户可写的版本目录，每个版本包含独立 `package.json`、`pnpm-lock.yaml`、`node_modules`、内核清单和 LDD 随包插件制品。

Harness 必须由独立 Node.js 运行时启动，不再用 `ELECTRON_RUN_AS_NODE` 运行。这样在线安装的 Sharp、PTY 等原生依赖与实际运行它们的 Node ABI 保持一致。

### 4.2 目录布局

```text
%PROGRAMFILES_OR_USER_INSTALL%\LDD\
  LDD.exe
  resources\
    runtime-host\node.exe
    runtime-host\pnpm\
    media\ffmpeg.exe
    media\ffprobe.exe
    runtime-fallback\...

%LOCALAPPDATA%\LDD\runtime\
  state.json
  downloads\
  staging\
  versions\
    0.1.1-rc.2\
      runtime.json
      package.json
      pnpm-lock.yaml
      node_modules\
      plugins\
  logs\

%APPDATA%\LDD\
  settings.json
  harness\
    profiles\
    ldd-managed\cordis.patch.yml
  backups\
```

程序目录中的 `runtime-fallback` 永远只读，作为最终救援内核。外部版本目录只通过版本指针切换，不覆盖正在运行或上一个可用版本。Harness profile、用户插件和用户 patch 位于 `DSH_HOME`，不复制进每个内核版本；LDD 自己生成的配置使用独立 `ldd-managed/cordis.patch.yml`，不得覆盖用户的 `cordis.patch.yml`。

## 5. Harness 启动与版本选择

启动优先级固定为：

1. `state.json.activeVersion` 指向且通过完整性检查的外部版本；
2. `state.json.lastKnownGoodVersion` 指向的外部版本；
3. 安装包内只读 fallback；
4. 全部失败时进入 LDD 故障页面，展示日志、重试、回滚和离线导入入口。

外壳为 Harness 设置：

- `DSH_HOME=%APPDATA%\LDD\harness`
- `LDD_RUNTIME_VERSION=<当前内核版本>`
- `LDD_FFMPEG_PATH=<随包 ffmpeg.exe>`
- `LDD_FFPROBE_PATH=<随包 ffprobe.exe>`
- `LDD_IMAGE_MODE=standard|large`

端口默认仍为 `127.0.0.1:3080`。如果已存在非本次 LDD 启动的 3080 服务，外壳不能直接附着；必须先通过 LDD 身份探针确认，避免连接到独立 Harness 或其他本地服务。冲突时选择空闲回环端口，并把实际地址写入运行状态。

## 6. 在线内核更新

### 6.1 更新源

在线检查读取官方 npm 注册表中的 `@deepseek-ai/dsh` 版本和发行完整性信息。LDD 记录 Stable、Prerelease 两个通道；本次 Harness 仍处于开发预览期，LDD 0.2.0 默认使用 Prerelease，并在更新确认框中明确提示可能存在兼容性变更。

首个 fallback 和首个离线运行时由用户提供的 0.1.1-rc.2 官方源码快照构建。后续客户端在线更新不在用户电脑上编译整个 monorepo，而是安装官方 npm 的精确版本；这样仍可自动更新，同时避免要求用户机器具备 Git、编译器和构建链。LDD 专属行为保留在外置配置和 LDD 插件中，默认不修改上游 Harness 核心；若实现中发现无法绕开的核心补丁，必须单独保存补丁文件、原因、适用版本和回归测试，不能直接形成不可追踪的源码分叉。

### 6.2 更新流程

1. 启动后延迟检查一次；之后每 24 小时最多自动检查一次。
2. 发现新版本时显示原生通知和“帮助 → Harness 内核更新”状态，不立即切换。
3. 用户点击更新后，下载和安装发生在新的 staging 目录。
4. 使用随包 Node/pnpm 安装精确版本，记录 npm `dist.integrity`、完整依赖锁文件和 Node ABI；禁止浮动依赖在后续启动时重新解析。
5. 检查包名、版本、文件清单、锁文件和入口脚本。
6. 先用全新临时 `DSH_HOME` 启动候选内核，再用真实 `DSH_HOME` 的只读副本启动并检查现有 profile/插件兼容性；两个阶段均使用随机端口。
7. 停止当前 Harness，把候选目录原子移动为正式版本并切换 `activeVersion`。
8. 使用真实 LDD `DSH_HOME` 启动；在观察窗口内启动失败、接口不兼容或现有插件导致组合失败时，自动恢复 `lastKnownGoodVersion`。若只有第三方插件不兼容，更新窗口列出插件并允许用户选择“暂不更新”或“安全模式验证”，不得静默删除或禁用插件。
9. 成功运行后才把新版本标记为 last-known-good；至少保留 fallback、当前和上一可用版本。

下载中断、磁盘空间不足、pnpm 安装失败、完整性不符和健康检查失败都不得改变当前版本。

### 6.3 健康检查

候选内核必须同时通过：

- `dsh --version` 与目标版本一致；
- `dsh web` 能在限定时间内启动并只监听回环地址；
- Web 根页面返回成功；
- LDD 所需 API/启动清单存在；
- DeepSeek 模型目录能够声明文本模型；
- 对 0.1.1-rc.1 及以上版本，视觉模型目录包含 `deepseek-v4-flash-vision-exp` 和 image 输入能力；
- LDD 视频插件能加载并注册工具；
- `dsh plugin --profile web list` 能通过 LDD 随包 pnpm 执行；
- 进程停止后没有遗留子进程。

## 7. 离线更新包

离线包扩展名为 `.lddruntime`，实质为不可在原地执行的 ZIP 包，至少包含：

```text
runtime.json
checksums.sha256
package.json
pnpm-lock.yaml
node_modules\
plugins\@ldd\dsh-video-frame-analyzer.tgz
```

`runtime.json` 包含格式版本、Harness 版本、目标平台、Node 主版本、创建时间、最低 LDD 版本、上游源码快照摘要、npm 完整性值、LDD 插件版本和所有关键文件摘要。第一版使用 SHA-256 全文件校验；同时预留 Ed25519 签名字段，签名密钥建立后可强制验签。

用户通过“帮助 → 导入离线内核包”选择文件。LDD 完成解压、路径穿越防护、摘要验证、兼容性检查和同一套候选健康检查后自动安装。用户不需要手动复制文件夹。

## 8. 数据迁移与兼容

LDD 0.1.0 未显式设置 `DSH_HOME`，Harness 数据通常位于 `%USERPROFILE%\.dsh`。LDD 0.2.0 改用专属 `%APPDATA%\LDD\harness`，避免以后与独立 CLI Harness 相互污染。

首次启动规则：

1. 如果新目录非空，直接使用，不执行迁移。
2. 如果新目录为空而 `%USERPROFILE%\.dsh` 存在，显示一次迁移确认，默认操作是“复制并验证现有 Harness 数据”。
3. 复制前记录文件清单，复制后在迁移候选目录启动 Harness 0.1.1-rc.2；不删除、不移动原 `.dsh`。
4. Harness 当前仍是预发布版本，源码明确不承诺旧会话/存储格式兼容。若 0.1.0-rc.3 数据被 0.1.1-rc.2 拒绝，LDD 保留旧数据归档并提供“使用全新数据目录启动”，不得把“桌面端更新成功”伪装成“旧会话已迁移成功”。是否能够转换旧会话，要在实施阶段对两版持久化格式完成差异验证后再决定。
5. 迁移失败时撤销新目录中的本次写入并继续使用 fallback 故障页，不修改原数据。
6. 每次首次运行新 Harness 版本前，对 LDD 专属 Harness 数据创建版本化备份；迁移或启动失败可恢复上一份备份。

会话、设置和凭据属于数据目录，不随内核回滚删除。若上游存储格式发生不可逆变化，健康检查必须使用备份副本，真实数据只在用户确认切换后迁移。

## 9. DeepSeek 视觉模型

首个验证内核固定为 Harness 0.1.1-rc.2。模型目录必须包含：

```text
provider: deepseek-official
model: deepseek-v4-flash-vision-exp
input: [text, image]
```

DeepSeek 适配器优先将请求派生图上传到 Files API，并复用有效的 `file_id`；上传不可用时才回退为内联图片。默认请求派生策略保留 Harness 上游值：约 640,000 总像素、单张编码上限 1 MiB。

选择纯文本模型时，Harness 必须显示图片占位信息或提示切换视觉模型，不得静默丢弃图片。选择视觉模型时，图片、`/goal`、`/plan` 和正常消息使用同一附件投影逻辑。

插件中心的 `dsh-plugin-multimodal`、`dsh-autovision` 等项目主要用另一个视觉模型给纯文本模型生成文字描述。Harness 0.1.1-rc.2 已原生提供 DeepSeek 视觉路由，LDD 不默认安装这些 sidecar，避免重复转写、额外延迟和模型配置混淆；用户仍可把它们作为第三方插件自行安装。

## 10. 图片大小策略

图片限制分为本地接收、规范化存储和提供方请求三层，不再把它们显示成一个含糊的“5MB 限制”。

### 10.1 普通模式（默认）

- 单张源图片：20 MiB
- 单条消息：最多 20 张
- 单条消息源图片合计：200 MiB
- 单张最大像素：64,000,000
- 单边最大尺寸：8192 px
- 存储规范化：最长边 2048 px、最多 4 MiB

### 10.2 高级大图模式

- 单张源图片：64 MiB
- 其他数量、总量、像素和边长限制与普通模式相同
- 图片转换并发固定为 1，降低高分辨率解码时的峰值内存
- 修改后需要重启 Harness，LDD 明确提示

### 10.3 提供方请求

- DeepSeek 视觉请求仍按模型策略生成约 1 MiB 的派生图，不把 64 MiB 原文件原样塞入请求。
- 优先 Files API；内联回退遵守请求体预算。
- 超过 64 MiB 的源图片不直接接收，提示用户先转换格式或降低尺寸。
- 不提供“无限制”选项，防止压缩炸弹、极端像素和内存耗尽。

图片模式保存在 LDD `settings.json`，由每个版本的 LDD Profile 转换为该版本 Harness 能识别的配置。更新内核不能重置用户选择。

## 11. 视频分析插件

### 11.1 路由原则

DeepSeek `deepseek-v4-flash-vision-exp` 接收图片而不是原始视频，因此 DeepSeek 路线固定为“本地读取视频 → 抽帧 → 调用视觉模型分析各批图片 → 把结构化文本结果交还当前主模型”。即使当前会话使用纯文本模型，也能通过插件内部配置的视觉模型分析；如果当前会话本身使用 DeepSeek 视觉模型，插件仍使用同一视觉路线而不是传原始视频。未来只有某个已配置模型明确声明 video 输入并且适配器实现了该内容类型时，才增加视频直传路线。

### 11.2 社区插件审查结论

插件中心已收录 [`@piedpiper911/dsh-video-tools`](https://github.com/PiedPiper911/dsh-video-tools)，其目标包含 FFmpeg.wasm 抽帧。但 0.1.0 源码存在以下阻塞项，因此不能原样作为 LDD 的交付实现：

- 工具接收“已存在于 FFmpeg 虚拟文件系统的文件名”，但公开工具路径没有把 Windows 工作区文件写入该虚拟文件系统；`writeInput()` 未接入工具执行路径。
- `video_frames` 返回虚拟文件系统中的文件名，没有把 JPEG 字节保存为 Harness 附件，也没有把帧交给视觉模型。
- `@ffmpeg/ffmpeg` 的浏览器 Worker/WASM 生命周期与 Harness Host 插件进程不匹配，且核心文件运行时从 unpkg 下载，不满足 LDD 离线可用和固定制品要求。
- 当前测试只是 `expect(true).toBe(true)` 的占位冒烟，未验证解码、抽帧、输出持久化、取消或清理。

因此 LDD 不直接安装该插件，也不宣称它已经完成端到端视频分析。LDD 自有插件可以参考其工具命名和用户流程，但使用随 LDD 固定版本的原生 FFmpeg/ffprobe，并按 Harness 官方插件规范完成真实组合测试。后续如果社区插件补齐这些能力并通过兼容验证，可把实现切换为已审查的上游版本。

### 11.3 插件接口

LDD 随内核安装 `@ldd/dsh-video-frame-analyzer`，注册：

- 工具：`analyze_video`
- 输入：本地视频路径、分析目标、可选时间范围、精度档位
- 输出：结构化视频观察、时间戳、关键帧引用、警告和所用视觉模型
- Skill：`video-analysis`，指导主模型在用户引用视频时自动调用工具

插件是标准 `dsh.bundle`，不修改 agent loop。它注入工具、附件、LLM、文件系统/工作区和子进程能力，默认视觉路由为 `deepseek-official/deepseek-v4-flash-vision-exp`，并允许用户在设置中选择其他明确声明 image 输入的模型。视频必须位于当前工作区或经过一次文件读取授权；插件在真正执行读取的操作上验证路径和权限，不能仅靠工具 schema 限制。

首版支持 MP4、MOV、MKV 和 WebM。FFmpeg/ffprobe 只从 LDD 受信任路径启动，参数使用数组传递，禁止拼接 shell 命令。插件先把单帧保存在 LDD 私有临时目录，再用带时间戳的联系表把多帧合成为较少的 JPEG。只有联系表和明确选中的关键帧保存为 Harness 图片附件；单帧临时文件在任务结束时清理。插件在调用视觉模型前追加可持久化的分析输入记录，包含模型、用户目标、时间段、抽帧参数和附件引用；视觉模型输出先校验为结构化观察，再作为普通工具结果进入当前会话日志。这样嵌套视觉请求可从会话记录重建，不形成不可追踪的模型输入。任务取消或插件卸载必须终止 FFmpeg 进程树、等待退出并清理临时文件。

### 11.4 抽帧策略

插件先用 ffprobe 获取时长、分辨率、帧率和音轨信息，再结合场景切换与固定时间间隔选择帧：

- 30 秒以内：基础间隔 1 秒；
- 30 秒至 5 分钟：基础间隔 3 秒；
- 5 分钟以上：基础间隔 10 秒；
- 场景切换帧优先保留并与间隔帧去重；
- 每张联系表最多 3×3 帧；单批最多 36 帧、4 张联系表，整次任务最多 144 帧、16 张联系表；
- 每帧最长边 1280 px，JPEG 质量自适应，单帧不超过 500 KiB；
- 超过一批时按时间段分析，再由主模型合并分段结果。

默认最大视频时长 60 分钟、文件大小 2 GiB。超限时要求用户指定时间范围，不把整个超长视频一次性处理。首版只报告音轨存在及基本元数据，不做自动语音识别；音频转录作为后续独立能力。

### 11.5 分析结果

插件返回：

- 视频元数据和实际抽帧策略；
- 按时间顺序的场景/动作描述；
- 可见文字与 OCR 置信提示；
- 关键对象、人物、镜头、画面变化；
- 与用户问题直接相关的证据时间戳；
- 未覆盖区间、低置信内容和解码警告；
- 视觉提供方、模型和请求批次数。

临时单帧位于 LDD 私有缓存目录，任务结束后清理；会话保存用于视觉请求的联系表/关键帧附件引用、精确分析输入记录和结构化结果。Harness 0.1.1-rc.2 的本地附件存储尚无引用感知的自动清理，因此 LDD 不承诺删除已经进入会话日志的附件；后续只能通过经过引用扫描的独立清理功能回收。

## 12. 插件中心与第三方插件

LDD 在“帮助 → 插件中心”打开社区索引 <https://github.com/topics/dsh-plugin>，并可引导用户安装可选的 [`dsh-market`](https://github.com/dsh-market/dsh-market)。LDD 不默认安装市场或任意第三方插件；用户点击安装前必须看到“插件以当前用户权限运行，可读取文件、凭据并联网”的提示。

插件安装、删除和升级使用 Harness 官方命令 `dsh plugin --profile web add|remove|update ...`，由 LDD 随包 pnpm 执行。用户插件保存在 `DSH_HOME` 的 profile 内，不随 Harness 内核版本目录切换而丢失。内核候选验证必须检测插件兼容性；安全模式只在临时副本中禁用第三方插件做诊断，除非用户明确确认，否则不改真实 profile。

## 13. 桌面端交互

LDD 原生菜单新增：

### 文件

- 导入离线内核包…
- 完全退出

### 帮助

- Harness 内核更新…
- 当前内核版本
- 回滚到上一内核
- 插件中心
- 打开更新日志目录

更新窗口显示桌面端版本、当前内核、可用内核、下载/安装/验证进度、失败原因和回滚状态。更新下载可以在 Harness 运行时进行，但切换版本必须停止并重启 Harness。

Harness 页面加载后，LDD 继续注入品牌标题和字标。更新提示使用原生通知和 LDD 本地更新窗口，不依赖上游 Web UI 的 DOM 结构。

## 14. 安全要求

- 所有服务只监听 `127.0.0.1`，不开放到局域网。
- Electron renderer 保持 context isolation、sandbox、无 Node integration。
- 更新 IPC 使用白名单和结构校验；renderer 不能传入任意命令或任意安装目录。
- ZIP 解压拒绝绝对路径、`..`、符号链接逃逸和重复覆盖。
- 在线安装只允许官方 `@deepseek-ai/dsh` 精确版本和 LDD 随包插件；不接受任意 npm 包名。
- 第三方插件安装是另一条明确的用户操作路径；必须显示来源、版本和权限风险，不能借内核更新静默夹带。
- 下载、安装和健康检查全部在 staging 中完成，切换使用原子状态写入。
- 更新日志和诊断导出必须遮蔽 API key、Authorization、cookie 和凭据文件内容。
- 更新失败不得删除当前版本、上一版本、fallback 或用户数据。

## 15. 源码与构建

新源码仓库根目录为 `ldd-desktop/`，至少包含：

```text
apps/desktop/src/main/
  harness/
  runtime-manager/
  media/
  ipc/
apps/desktop/src/preload/
apps/desktop/src/renderer/
packages/video-frame-analyzer/
packages/runtime-package/
upstream/deepseek-harness/
tests/
docs/superpowers/specs/
docs/superpowers/plans/
```

`upstream/deepseek-harness/` 来自用户提供的官方 0.1.1-rc.2 源码快照，保留原始 `AGENTS.md`、文档、包边界和许可证。LDD 外壳才从当前 EXE 中恢复出的模块边界重建为 TypeScript 源码，并为现有行为补充测试。不得把压缩后的构建文件当作长期源码继续修改。

Harness 构建遵守上游要求：Node `^22.19 || >=24`、pnpm workspace、`pnpm run build`，并在变更涉及上游包时执行对应测试、类型检查、文档同步和真实组合测试。LDD 的首选策略是零上游核心改动；图片模式通过配置完成，视频通过外置 bundle 完成。

Windows 构建使用 Electron、TypeScript、React、Vitest 和 electron-builder/NSIS。构建脚本生成：

- `LDD-Setup-0.2.0-x64.exe`
- `LDD-0.2.0-source.zip`
- `deepseek-harness-0.1.1-rc.2-windows-x64.lddruntime`

## 16. 测试要求

### 16.1 单元测试

- 版本选择和 fallback 顺序
- semver 通道过滤和更新状态机
- 原子状态写入和损坏状态恢复
- SHA-256、清单、ZIP 路径安全和平台兼容校验
- 下载中断、磁盘不足和重复版本
- 图片普通/高级模式配置映射
- 端口身份探针和冲突处理
- 视频抽帧时间点选择、批次切分和上限
- 视频路径授权、参数数组构建、取消、进程树退出和缓存清理
- 日志凭据脱敏

### 16.2 集成测试

- 使用临时目录完成在线安装模拟、候选健康检查、切换和回滚
- 使用离线 `.lddruntime` 完成导入
- fallback、当前和上一版本分别能够启动
- 旧 `.dsh` 复制迁移成功和失败撤销
- 20 MiB 普通模式、64 MiB 高级模式和超限拒绝
- 图片请求进入 DeepSeek 视觉适配器并优先 Files API
- 15 秒、5 分钟和超长视频的抽帧及结构化分析
- FFmpeg 失败、损坏视频和视觉模型失败的可恢复错误
- `dsh plugin` 通过随包 pnpm 安装、更新、移除一个测试 bundle
- 候选内核在第三方插件不兼容时保持当前版本和真实 profile 不变
- 视频插件通过真实 Loader/profile 组合测试，并用 keyless snapshot 固定工具 schema、分析输入事件和用户可见结果

### 16.3 Windows 验收

在干净的 Windows 10 和 Windows 11 x64 虚拟机上验证：

1. 无 Node、pnpm、Python、Harness、FFmpeg 也能安装和运行。
2. 首次启动可导入现有 `.dsh`，原目录不被删除。
3. 当前 0.1.0 数据迁移会先复制和验证；无论兼容与否，原数据均不被修改，且不兼容时可以使用全新数据目录启动。
4. 在线检查可发现、安装和切换验证版本。
5. 离线包无需手动复制目录即可安装。
6. 故意破坏候选内核后会自动回滚。
7. DeepSeek 视觉模型可以分析 JPEG、PNG、GIF、WebP。
8. 5 MiB 限制不再存在；20 MiB 默认可用，高级模式接受 64 MiB。
9. 视频插件能分析本地视频并返回带时间戳的结构化结果。
10. 关闭窗口仍驻留托盘，完全退出会结束 Harness 和 FFmpeg 子进程。
11. 插件中心可打开，插件安装风险提示明确，第三方插件不会被内核更新静默安装。

## 17. 发布与回滚

LDD 0.2.0 为内部未签名测试版本。安装前保留原 0.1.0 安装包。新安装包升级时不删除 `%APPDATA%\LDD`、`%LOCALAPPDATA%\LDD` 或 `%USERPROFILE%\.dsh`。

若桌面外壳出现问题，可重新安装 0.1.0；若仅 Harness 出现问题，优先使用内核回滚，不需要重装 LDD。卸载程序必须询问是否保留用户数据，默认保留。

## 18. 完成标准

本次工作只有在以下文件均交付并完成上述 Windows 验收后才算完成：

1. LDD 0.2.0 可编辑源码；
2. Windows x64 安装包；
3. Harness 0.1.1-rc.2 离线内核包；
4. 自动化测试和 Windows 验收记录；
5. 内核更新、离线导入、图片模式、视频分析和回滚使用说明。
6. 官方 Harness 源码快照摘要、构建记录和社区视频插件审查记录。

## 19. 依据与审查来源

- Harness 0.1.1-rc.1 加入 `DeepSeek-V4-Flash-Vision-Exp`，0.1.1-rc.2 加入 Files API 优先上传和图片预处理优化：<https://github.com/deepseek-ai/deepseek-harness/releases>
- 当前 Harness 附件后端默认接收单张 20 MiB、单消息 200 MiB，并执行规范化：<https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.1-rc.2/packages/attachment/attachment-local>
- DeepSeek 适配器的请求图片预算、Files API 和内联回退说明：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/README.zh.md>
- DeepSeek 图像理解接口限制：<https://api-docs.deepseek.com/zh-cn/guides/vision>
- Harness 插件安装协议和 profile 机制：<https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.zh.md>
- 社区插件索引与安全提示：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>
- 已审查但不直接采用的社区视频插件：<https://github.com/PiedPiper911/dsh-video-tools>

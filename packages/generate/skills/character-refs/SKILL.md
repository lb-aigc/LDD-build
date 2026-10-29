---
name: character-refs
description: Use when the user wants real character reference images (character sheet / 三视图 / 定妆照 / turnaround) for a story — generate an anchor full-body front view, then derive headshot, side, and back views that all reference the anchor. Use generate_image for this. NOT for video prompts, and NOT for text-only character profiles (use novel-adaptation for that).
---

# 角色参考图 — 三视图锚点法（真出图）

输入一段角色描述，输出一组角色参考图（给视频模型当参考图 + 给人看）。核心是**三视图锚点法**：一张正面全身锚点（文生图），其余所有视图都「只参考这张锚点」做图生图。用 `generate_image` 出图，不用脚本。

## 核心规则（先读懂再动手）

- **一组图只有一个根：正面全身锚点**。只有它是文生图；其余全是「锚点 + 一句改图指令」（`inputImages` 传锚点）。
  图与图之间不互相参考——任何一张出坏了，单独重出这一张，不连锁。
- **分档出图，默认出到第二档**：

  | 档位 | 内容 | 什么时候出 |
  |------|------|-----------|
  | 1 | 正面全身（锚点）| 总是，第一张 |
  | 2（默认）| 正脸大头照、90° 侧面（面朝画面右侧）、背面 | 默认出齐 |
  | 3 | 细节图（最多 8 张）：发饰 / 领口 / 袖口 / 鞋等最能认出角色的地方 | 有配饰或服装局部特写 |
  | 4（默认不出）| 45° 大头照（面朝画面左侧）| 用户明确要 |

  H3 实测：只给正面全身，脸会走样；**加一张大头照，脸最接近**。所以默认出齐第二档。

- **拆角色描述**：用户一段话描述角色即可，你来拆字段。**年龄、性别、年代推不出来就问用户**（只有这三样不许自己编）；其余一律自己补，不要逐项追问。
- **服装分 `top` / `bottom`**——大头照只用上装，带上下装模型会把镜头拉远。
- **锚点要先确认再出派生**：锚点是全组的根，它不对后面全白出。出完锚点把图给用户看，用户说可以再出大头照/侧面/背面；不满意就重出锚点（换 prompt 或换 model）。

## 流程

1. **收描述** → 拆字段（年龄/性别/年代缺就问），画风默认动漫（用户说写实就写实，同剧所有角色用同一画风）。
2. **出锚点**：`generate_image` 文生图出「正面全身」，prompt 写清：角色外貌、服装（top/bottom）、姿势（正面站姿）、**白底**、全身入镜。永远英文、不写角色名、不写画风词进 image prompt。
3. **确认锚点** → 出第二档：
   - 正脸大头照：`inputImages` 传锚点 + prompt「close-up of the same face, head and shoulders」
   - 90° 侧面：`inputImages` 传锚点 + prompt「side profile, facing right, same character」
   - 背面：`inputImages` 传锚点 + prompt「back view, same character, full body」
4. **按需升档**：细节图（`inputImages` 传锚点 + 特写指令）。
5. **检查**：每张过「尺寸正常、比例对得上、背景够白」；**长相/角度/取景要靠眼睛看**，没看过图不要说「效果很好」。

## 边界

- 实测可靠的画风只有**写实**和**动漫**两种；自定义画风先出锚点看效果。
- 细节图只收长在角色身上的（发饰/领口/袖口/鞋）；道具归美术资产环节。
- 已知短板：小疤痕容易画成新伤；大面积细节取景偏远；粗布可能被画得像丝绒（重出这一张）。
- 每一张图都要记住它「参考了锚点」——一致性来自「同一张锚点」，不来自「同一个模型」。

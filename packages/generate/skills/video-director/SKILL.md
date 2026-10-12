---
name: video-director
description: Use when the user asks to turn a multi-shot short-drama script or storyboard into Seedance video prompts — multiple segments with characters, blocking continuity across segments, and reference-image asset locking. NOT for single-shot dance/atmosphere/game clips.
---

# Short-drama video prompts — director workflow

Multi-shot short drama = a script or storyboard → a sequence of Seedance segment prompts. This is the restructuring / blocking / asset-lock / acting layer that `generate` (general rules) does not cover. Read `generate` first for the shared emotion/camera/engine limits, then apply this.

## 1. Director restructure — shots are emotion containers, not action records

A supplier storyboard is an ACTION LOG ("shot 1 he does X, shot 2 she does Y"). The director's job is EMOTION PACING — every shot carries one emotion function. Do not translate the storyboard verbatim; rebuild it as an emotional rhythm first.

### Reaction shots are the soul
After every event, the most valuable shot is "the face of the person who saw it". Supplier storyboards are almost all event shots with no reaction shots — the reaction shot is the FIRST thing to add.

### The four moves
| Move | When |
|---|---|
| Split (拆镜头) | One shot crams "event + reaction" or several actions → split into event shot + reaction shot |
| Add (补镜头) | Missing reaction / transition / setup → add it |
| Merge (合镜头) | Same emotion, continuous action → merge (long-take thinking) |
| Patch (补戏) | Causality reversed, missing motive, drifting contact state → patch the logic |

### One shot = one subject (engine boundary)
Seedance renders ONE focal subject per shot; everyone else becomes background. A supporting character's reaction is carried by CUTTING to a dedicated shot where they are the sole subject — never by expecting the whole crowd to move in a wide shot.

### Re-segment freely (4–30s elastic, don't stay boxed in the supplier's 15s)
1. Segment by EMOTION UNIT — one unit = a complete arc (establish → event → reaction → landing).
2. Segment length 4–30s, set by content, never mechanically padded to 15s.
3. MERGE a continuous action line that has no emotional break — kills one seam.
4. SPLIT at an emotional turn.
Core: any action line that fits inside 30s must be solved with IN-SEGMENT cuts (one generation = naturally continuous), never left to a cross-segment seam.

### Rebuilt shot table (show the user before writing prompts)
Produce `| 镜 | 景别 | 内容 | 情绪功能 |` and confirm the pacing, THEN write prompts.

## 2. Whole-episode blocking table (before any prompt)

Seedance generates each segment independently with no memory. Continuity lives entirely in "segment N's opening position = segment N-1's closing position".

| 段 | 角色 | 开头站位(=上段结尾) | 段内移动 | 结尾站位(=下段开头) |
|---|---|---|---|---|

Iron rule: the opening column of segment N equals the closing column of segment N-1, VERBATIM. Before writing episode N, read episode N-1's blocking table's LAST row and use it as episode N segment 1's opening.

### Anchor to real landmarks
Anchor positions to objects that EXIST in the scene image (which chair / which door / which pillar), never an abstract screen position, never invented NORTH/WEST bearings (writing bearings from memory comes out opposite to the scene's real geometry).

### Confrontation vs group scene
- Group scene → characters face the audience side by side.
- Two-person confrontation → FACE EACH OTHER (one faces left, one faces right, faces toward each other). NEVER write both as "facing the audience" — that flattens a confrontation into side-by-side standing and breaks the axis.

### Re-state the scene geography in EVERY shot
Character blocking is locked but the BACKGROUND drifts too. Re-state the main-scene landmark every shot ("the apothecary doorway, the pyre stake still visible behind"), and name WHICH door explicitly — a vague "the doorway" gets hallucinated into the wrong door and the scene drifts.

### Preferred continuity: a real captured frame
Segment N opens with segment N-1's LAST captured frame as the reference image, reinforced by one English prose line ("Starting from the reference frame's blocking…"). This is the only reliable way the engine "sees" where the last segment stopped.

## 3. Asset lock (multi-reference)

### Core anchors (must not drift across shots)
Eye color (hardest — the viewer reads identity from it first) > skin tone > hair style > costume silhouette > signature prop. Across an age jump keep eye color + skin tone + hair identical.

### Reference-role declaration
Each reference declares its fidelity (full-preserve / partial-preserve / attribute-transfer / loose-guide) + an exclusion clause ("Do not use its pose or background"). Only upload assets this scene uses — an uploaded-but-unused reference can leak into the frame.

### Anti-contamination lock (text-only characters)
A prose-only character (no reference image) gets CONTAMINATED by the referenced faces — the model reuses the referenced leads' faces to fill in the un-referenced people. Write an explicit "does NOT match any reference image" lock + a DISTINCT look.

### Pure-text mode caps at TWO people
With no reference images, 3+ overlapping bodies collapse into fused limbs and floating flesh. Split a 3-person beat into single/two-person shots.

### Scene objects live in the scene image
Text-only wall objects are silently ignored — the engine renders only what the scene image SHOWS. If a scene needs an object the image lacks, submit it as a separate asset image or drop it; never text it in and expect it to appear.

## 4. Acting — flowing paragraph

Acting = behaviour under pressure, not a display of emotion.

### Five pillars (every on-screen character)
1. Objective (a verb aimed at an opponent, never a state like "angry")
2. Obstacle + stakes (what blocks them; the cost must scare the character)
3. Tactics (action verbs; when one fails, they switch — the living never use one tactic all the way)
4. Beats (each beat change is visible in behaviour; a good scene has 2–4)
5. Subtext (what they mean vs what they say — it leaks, never played)

### Eye life (the #1 tell of AI dead-eyes)
Micro-saccades + gaze lock (the gaze keeps moving, never frozen); blink rate follows state; wet catchlight; eyes reach the target before the head turns.

### Flowing-paragraph template (150–220 words per character, one prose block)
`[NAME]. [posture = biography]. [one-line inner engine]. Vocal profile: [...]. Key habits and tics: [tic + trigger]. Walking style: [named gait]. However, when [trigger], [shift]. [optional: one softening object].`

Write only observable behaviour; every tic carries a trigger; every profile has at least one "However, when X —" turn.

### Acting scale (self-check, lead ≥ 4)
0 puppet / 1 recital / 2 diligent / 3 craftsman / 4 alive / 5 magnet (a paradox — the character holds two truths at once).

### Group scenes
Reactions ripple, never synchronize; the most valuable frame after an event is "the face of the one who saw it"; movement = motive (nobody crosses a room for no reason).

## 5. Emotion code table (6+1 × four dimensions)

Translate an emotion into observable body markers across all four dimensions — never write the label.

| Emotion | Face | Eyes | Body | Voice |
|---|---|---|---|---|
| Anger 愤怒 | brows down+drawn, eyes wide or narrowed, lips tight/bared | hard unblinking stare | lean in, fist, shoulders up, sharp short moves | volume up OR dangerously low, words through teeth |
| Fear 恐惧 | brows up+drawn, eyes wide, mouth open/tight | dilated pupils, scanning, rapid blink | recoil, arms crossed, stiff/trembling | trembling, fast broken, weak tail |
| Sadness 悲伤 | inner brows up, mouth down, lip trembling | unfocused down, slow heavy blink, tear unshed | head down, shoulders dropped, slow | low slow, many pauses, choking |
| Disgust 厌恶 | nose wrinkled, lip up, eyes narrowed | averted/sidelong, fast blink | lean back, hand raised as barrier | short, spitting out the words |
| Joy 快乐 | crow's feet, mouth up | bright, soft, laugh lines | relaxed, open, light step | bright rising, laughter in the tail |
| Surprise 惊讶 | brows high, eyes wide, mouth open | snap to the source, pupils first | freeze, breath catches | brief silence or a short "ah" |
| Contempt 轻蔑 | ONE-SIDED mouth up (asymmetric), eyes narrowed | looking down, cold with a smile | relaxed, occupies space, slow | slow soft, stress on key words, like a handout |

### The hypocrite's crack (villain tension)
The surface emotion (a gentle smile) sits over the real one (the kill intent), and the real one LEAKS through at a moment. A living character's emotion is two layers; an AI's is one. This is the "AI-feel" vs "alive" divide.

## 6. Output format — MCSLA lean prose

### Body text is ALL ENGLISH (iron rule)
Scene / acting / camera all in English; dialogue in `{}` + British RP. Chinese descriptions are understood at a discount (verified: Chinese "跪" generated "standing").

### Five golden rules
1. Lean: 15s ≈ 80–150 words, 30s ≈ 200–400, cap 1000. Every extra sentence dilutes.
2. Positive phrasing, NO negative words: "clean dry skin" not "no acne". NOT/never/no inject the forbidden concept.
3. States not transitions: write "mid-throw, arm extended", not the process.
4. One action, one camera move per shot.
5. Acting = a flowing paragraph, not bullets.

### WHO IN FRAME lock (every shot)
First line of every shot states who is and is not in frame ("Only Cora and Adrian in frame — Wren off-frame at their feet"). A close-up that doesn't restate this DROPS supporting characters.

### 15s = 3–5 shots
More cuts ease editing; emotion scenes lean fewer (3 long holds), action scenes lean more (5 quick cuts). Each shot still one action, one move.

### Prop hard-anchor
Size + shape + material, positive phrasing: "an oval silver medallion the size of a palm, stamped with the white tower's pattern, thick heavy edges". A name alone ("curved-tooth pendant") doesn't lock shape.

### Pre-delivery QA (silent self-check)
- [ ] Body all English, dialogue `{}` + RP
- [ ] Word count matches duration
- [ ] 15s = 3–5 shots
- [ ] Every shot has WHO IN FRAME
- [ ] No negative words (unless a verified prior failure)
- [ ] Every character has a flowing paragraph
- [ ] Every shot opens with a blocking prose line (screen side + facing whom)
- [ ] Props carry size + shape + material
- [ ] Closing line states the final pose (what segment N+1 continues from)

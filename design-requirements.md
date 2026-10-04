# Sensory-aware Kraków walking-route planner

Design requirements and user flows · Version 1.0 · 3 October 2026

Audience: the implementation agent and the design team. Product state assumed: Noise, Light and Crowds are all implemented and live.

## 0. How to use this document

- **Keywords.** MUST, SHOULD and MAY follow RFC 2119. MUST items block release.
- **Row format.** Every requirement has an ID, the requirement, the rationale with an evidence tag, and the standard it corresponds to.
- **Evidence tags.** \[S\] = mandated by a published standard or law. \[R\] = supported by published guidance or research. \[H\] = design judgement, to be validated in testing. Standards are authoritative; \[R\] and \[H\] rows are directional. Where no formal standard exists, the Standard column says None.
- **Conformance target.** WCAG 2.2 Level AA on every screen, plus the AAA criteria named in the tables.
- **\[DATA\] markers.** A value (threshold, cadence, source) that the data team must supply before build.
- **Abbreviations.** WCAG = Web Content Accessibility Guidelines 2.2 (W3C). COGA = W3C Making Content Usable for People with Cognitive and Learning Disabilities (objectives cited by name). EAA = European Accessibility Act, Directive (EU) 2019/882. GDPR = Regulation (EU) 2016/679. HIG = Apple Human Interface Guidelines. Material = Google Material Design.
- **What proof means here.** Each row cites the standard or source behind it. Following the rows does not guarantee the app is comfortable for every user, so Section 6 defines validation with real users.

## 1. Product context and design principles

**What it is.** A walking-route planner for Kraków that ranks routes by the user’s profile, not only by distance.

**Factors (all live).**

- Noise: avoid loud, high-traffic streets.
- Light: one factor with three states: Avoid bright places, No preference, Prefer well-lit routes.
- Crowds: avoid busy, crowded areas.

**Time dependence.** Crowds and light change by hour, so every route is computed for a specific time (Now or Leave at).

**Users.** Neurodivergent people (autism, ADHD, sensory processing differences); people with migraine, anxiety or PTSD; women and others who want well-lit night routes; secondary: people with mobility needs. Many also have colour-vision differences or other disabilities.

**Principles.**

- P1. The interface embodies what it promises: low sensory load.
- P2. Honesty about data gaps is a first-class feature. Unknown never looks like safe or quiet.
- P3. Never colour alone.
- P4. The user is in control. Nothing changes unless asked.
- P5. Predictable. Same thing, same place, same name.
- P6. Estimates, not guarantees. No safe-route claims.

**Changes from the earlier wireframe.**

- Light is one three-state control, not two chips, because avoid-bright and prefer-well-lit contradict each other.
- The Crowds chip is live, no longer marked soon.
- A When selector is added under the destination fields.
- A Compare view is added to the results sheet.
- A Help button sits beside Settings, top-right.

* An I don’t feel well button with a calm-place flow (rules in 2N, flow F13).

- Businesses can submit places with accessibility features such as quiet hours (rules in 2O, flows F14 to F18).

* Users can vote whether data is accurate, and every data item shows a Verified or Not verified label with dates (rules in 2P, flow F19).
* Hackathon demo scope is defined in 2P.

## 2. Requirements

### 2A. Colour and contrast

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| COL-01 | Body text and essential labels MUST reach 4.5:1 contrast. Large text (24 px, or 18.66 px bold, and up) MUST reach 3:1. | \[S\] Low contrast is consistently among the most frequently detected web accessibility failures (WebAIM Million). It also affects anyone outdoors in sunlight. | WCAG 1.4.3 (AA) |
| COL-02 | Text SHOULD target 7:1 or more using the Section 3 tokens, but body text SHOULD stay below about 13:1. Never pure #000 on #FFF in either theme. | \[H\] 7:1 is the AAA level. Evidence that maximum contrast causes visual stress (reported in dyslexia, migraine, autism) is mixed, and WCAG sets no upper limit. The soft ceiling is a precaution to validate in testing. | WCAG 1.4.6 (AAA, adopted). Upper limit: None |
| COL-03 | Icons, input borders, focus rings, toggles and route lines MUST reach 3:1 against adjacent colours. | \[S\] Controls and meaningful graphics must be perceivable. | WCAG 1.4.11 (AA) |
| COL-04 | Colour MUST NOT be the only carrier of meaning. Every colour cue has a second cue: text, icon, pattern, line style or position. | \[S\] About 8% of men and 0.5% of women have colour-vision deficiency (Colour Blind Awareness). Target users often have overlapping needs. | WCAG 1.4.1 (A), 1.3.3 (A) |
| COL-05 | The palette MUST be muted: neutral surfaces, one accent, no neon, no large saturated fields, no red/green pairs. Only one filled accent button per screen. | \[R\] The UI should embody the low-stimulation promise. The colour-and-emotion literature is mixed, so the rule is restraint, not a magic calming colour. | COGA: Minimize distractions. WCAG: None |
| COL-06 | Route colours MUST be colour-vision safe: blue and amber differ in lightness as well as hue, and each route also has a letter label, a line style and a weight. Validate with protanopia, deuteranopia, tritanopia and achromatopsia simulation. | \[S\] Redundant encoding. A lightness difference survives most colour-vision types. | WCAG 1.4.1, 1.4.11 |
| COL-07 | Light and dark themes MUST both be first-class and meet every contrast row. Default is the device setting; the user can override. Switching theme MUST NOT flash. Dark uses a dark blue-grey, not black. | \[R\] Light sensitivity makes a true dark theme important. | WCAG 1.4.3, 1.4.11; HIG Dark Mode; Material dark theme |
| COL-08 | The app MUST honour increased-contrast and forced-colours settings (prefers-contrast, forced-colors, iOS Increase Contrast, Android high-contrast text). Patterns and borders MUST still show when colours are overridden. | \[S\] Users who set system contrast need it respected. | WCAG 1.4.11, 1.4.1; CSS Media Queries Level 5 |
| COL-09 | Errors and warnings MUST use text, an icon and a border or marker in a muted brick or amber token. No full-screen red, no flashing. | \[R\] Alarming treatments raise anxiety for target users. | WCAG 1.4.1, 3.3.1; COGA: Help users avoid mistakes and make it easy to correct them |
| COL-10 | The basemap MUST be a muted style with lower contrast than route lines and no point-of-interest clutter by default. Route lines MUST have a 2 px casing that contrasts 3:1 with the line. | \[S/H\] Map tiles vary, so line-to-tile contrast cannot be guaranteed. The casing makes it independent of the tile. | WCAG 1.4.11 |

### 2B. Typography and layout

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| TYP-01 | Text MUST scale to 200% without loss of content or function. Honour OS text scaling (iOS Dynamic Type, Android font scale) to at least 200%. | \[S\] Low vision, dyslexia, ageing. | WCAG 1.4.4 (AA) |
| TYP-02 | Layouts MUST reflow at 320 CSS px width with no two-dimensional scrolling, except the map. | \[S\] Magnified use. | WCAG 1.4.10 (AA) |
| TYP-03 | Layouts MUST survive user overrides of line height (1.5x), paragraph spacing (2x), letter spacing (0.12em) and word spacing (0.16em). Body text SHOULD default to at least 16 px with line height at least 1.5. | \[S\] Dyslexia and low-vision reading support. | WCAG 1.4.12 (AA) |
| TYP-04 | Use one humanist sans-serif family. Text is left-aligned, never justified, with no long italic or all-caps passages and lines of at most 80 characters. | \[R\] British Dyslexia Association style guide; WCAG AAA visual presentation. | WCAG 1.4.8 (AAA) |
| TYP-05 | No text in images, including route labels and the legend. | \[S\] | WCAG 1.4.5 (AA) |
| TYP-06 | Screen orientation MUST NOT be locked. | \[S\] Mounted devices, motor needs. | WCAG 1.3.4 (AA) |

### 2C. Personalisation and low-stimulation mode

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| PER-01 | Settings MUST include theme (Light, Dark, Match device), text size, Low-stimulation mode, reduce motion, haptics, sound and in-walk cues. Each applies instantly with a preview. | \[R\] Personalisation is the main mitigation when needs differ this much between users. | COGA: Support adaptation and personalization |
| PER-02 | Low-stimulation mode MUST: remove all non-essential animation; show only the selected route and at most one overlay; mute the accent colour to neutral except on the primary button; hide basemap labels except streets on the route; disable sound and haptics; use a single column. | \[H\] The definition is ours. Validate it with target users. | COGA: Minimize distractions; WCAG 2.3.3 (AAA) |
| PER-03 | On first launch the app MUST read OS settings (dark mode, reduced motion, text size, contrast), apply them, and say so. | \[S/R\] Users have already told their device what they need. | WCAG 1.4.4, 2.3.3; HIG; Material |
| PER-04 | Settings SHOULD persist across sessions, with a Reset to defaults action. | \[R\] | COGA: Ensure processes do not rely on memory |
| PER-05 | The UI SHOULD be available in Polish, English and Ukrainian, with the language declared in code. | \[H\] Kraków has many international students and Ukrainian-speaking residents; confirm in research. Declared language makes screen readers pronounce text correctly. | WCAG 3.1.1 (A), 3.1.2 (AA) |

### 2D. Motion and flashing

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| MOT-01 | Nothing may flash more than three times per second. | \[S\] Photosensitive seizure risk. | WCAG 2.3.1 (A) |
| MOT-02 | All non-essential motion MUST respect reduce-motion settings and default to none in Low-stimulation mode. | \[S\] AAA adopted. Vestibular disorders and migraine triggers. | WCAG 2.3.3 (AAA); prefers-reduced-motion |
| MOT-03 | Moving or blinking content lasting over 5 seconds MUST have a pause control, or not exist. | \[S\] | WCAG 2.2.2 (A) |
| MOT-04 | The map MUST NOT auto-pan or auto-zoom except after an explicit action (select a route, press Locate). Camera moves are instant, or at most 200 ms eased; instant under reduce-motion. | \[R/H\] Unexpected motion is a disorientation and overload trigger. | WCAG 2.3.3; COGA: Minimize distractions |
| MOT-05 | No pulsing halos, marching-ants dashes, shimmer loaders or parallax. Uncertainty dashes are static. Loading uses static text. | \[H\] | WCAG 2.2.2, 2.3.3 |
| MOT-06 | No feature may require shaking or tilting the device. | \[S\] | WCAG 2.5.4 (A) |
| MOT-07 | The live position marker MUST be static (no pulse) in Low-stimulation mode. | \[H\] | WCAG 2.3.3 |

### 2E. Data confidence (the honesty requirements)

Per factor and per segment there are three data states.

- **Known.** Confidence at or above \[DATA\] threshold, and fresh enough for the chosen time.
- **Estimated.** Confidence between the low and high \[DATA\] thresholds, or a typical pattern rather than live data.
- **No data.** No source, confidence below the low threshold, or older than \[DATA\].

On the map, Known and Estimated draw solid and No data draws dashed with a ? marker. The difference between Known and Estimated is carried in text.

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| UNC-01 | Every segment MUST be in exactly one state per active factor. No data MUST NEVER be drawn, scored or worded as quiet, dark or empty. | \[R\] Users’ trust should match a system’s real reliability (Lee and See, 2004, Human Factors). In a safety-adjacent context, false reassurance can cause harm. | None (formal). Supports WCAG 1.3.1 |
| UNC-02 | No data MUST be shown by four cues together: a dashed line, a hatch pattern on areas, a ? marker, and the words No data, in the neutral violet-grey token. | \[S\] Redundant encoding. | WCAG 1.4.1, 1.4.11, 1.3.3 |
| UNC-03 | Known and Estimated MUST be distinguished in text in details, cards and speech (Low noise versus \~Low noise, typical pattern). | \[H\] Keeps the map low-load while staying honest. | COGA: Use clear and understandable content |
| UNC-04 | Each route card MUST show per-factor coverage in words (Noise: 82% known). Do not average factors into one number. | \[R\] A single number hides which factor is missing. | COGA: Help users understand what things are |
| UNC-05 | Ranking MUST treat No data as unknown, never as best case. When scores are close, routes with more known data SHOULD rank higher, controlled by a setting Prefer routes with more data (default on). | \[R/H\] Optimisers otherwise route people through unmapped streets, because missing noise data scores as zero noise. | None |
| UNC-06 | Every segment detail MUST show per factor: level word, state, source, last-updated date, and Live or Typical-for-time. | \[R\] Calibrated trust needs visible provenance. | None |
| UNC-07 | Crowd and light values MUST be time-scoped to the chosen departure time and labelled (Typical for Sat 18:00, Live, After sunset). | \[R\] These factors change by the hour. A time-less value misleads. | None |
| UNC-08 | Data older than \[DATA\] MUST be downgraded to Estimated or No data and show its age. | \[R\] | None |
| UNC-09 | A Legend MUST be reachable in one tap from the map and from Help on every screen, explaining solid, dashed, ? and \~. | \[R\] | WCAG 3.2.6 (A); COGA: Provide help and support |
| UNC-10 | Gap wording MUST be neutral: No data yet, plus an action (Report what you see, Avoid this stretch). No unsafe, no danger, no reassuring words. | \[H\] | COGA: Use clear and understandable content |
| UNC-11 | Screen readers MUST announce the state for each segment and card (Noise: no data). | \[S\] | WCAG 1.3.1, 4.1.2 |
| UNC-12 | While walking, entering a No data stretch MUST give a calm visual cue (Next 200 m: no noise data). Sound or haptics only if the user enabled them. | \[H\] | WCAG 4.1.3 |

### 2F. Factors and route choice

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| FAC-01 | Provide Noise, Crowds, and Light as one three-state control (Avoid bright, No preference, Prefer well-lit). Contradictory states MUST be impossible. | \[R\] Prevent mistakes by design. | WCAG 3.3.2; COGA: Help users avoid mistakes |
| FAC-02 | Factor controls MUST be toggle buttons exposing pressed state, with a check icon plus text, at least 44 px high. | \[S\] | WCAG 1.4.1, 4.1.2, 2.5.5 (AAA adopted) |
| FAC-03 | Every factor MUST have an info control explaining what it measures, the data source and known limits, in at most two sentences. | \[R\] | COGA: Help users understand what things are and how to use them |
| FAC-04 | A When selector (Now by default, Leave at plus a time) MUST be on the planning screen. | \[R\] Crowds and light vary by hour. | None |
| FAC-05 | Provide Strictness (Flexible default, Strict) and Maximum extra time (+5, +10, +20 min, No limit; default \[DATA\]). Cards show the cost (+4 min vs shortest). | \[H\] Some users want a hard avoid even at a cost; others do not. | COGA: Support adaptation and personalization |
| FAC-06 | When factors disagree (quietest differs from best-lit), show each route’s per-factor trade-offs. Do not use a hidden composite score or declare one best. | \[R\] Transparent trade-offs support appropriate reliance. | None |
| FAC-07 | A Shortest route MUST always be shown as a reference. | \[H\] Lets users judge the cost of a detour. | None |
| FAC-08 | Show at most three routes. | \[H\] Hick’s law: more options slow decisions and raise stress. | COGA: Minimize distractions |
| FAC-09 | Use the words Quiet, Moderate, Loud for noise; Dim, Moderate, Bright for light; Few people, Some people, Many people for crowds. Crowd density uses a stipple pattern (sparse to dense) in one neutral tone, never a red heatmap. Verify pattern contrast at 3:1. | \[R/H\] A distinct vocabulary per factor avoids confusion. Ordinal data uses a single neutral hue plus text. | WCAG 1.4.1, 1.4.11 |

### 2G. Map

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| MAP-01 | Every route MUST have a text alternative: an ordered step list plus a per-segment summary. The map MUST NOT be the only way to read a result. | \[S\] Non-visual access to the core task. | WCAG 1.1.1 (A), 1.3.1 (A), 2.1.1 (A) |
| MAP-02 | Every map gesture MUST have a single-pointer alternative: zoom plus and minus buttons, pan buttons or keyboard arrows. No pinch-only or path-based gestures. | \[S\] Motor and tremor needs, switch access. | WCAG 2.5.1 (A), 2.5.7 (AA), 2.1.1 |
| MAP-03 | Map controls (zoom, locate, layers, legend) MUST be at least 44 by 44 with 8 spacing. | \[S/R\] 24 px is the AA minimum. 44 is AAA and the HIG minimum. Material uses 48 dp. | WCAG 2.5.8 (AA), 2.5.5 (AAA) |
| MAP-04 | The map MUST be a labelled region with a skip link past it. Route selection MUST work from the list. Sheets MUST NOT hide the focused element. | \[S\] | WCAG 2.4.1 (A), 2.4.11 (AA), 4.1.2 |
| MAP-05 | Overlays (noise, light, crowds) are off by default. A Layers control toggles them. In Low-stimulation mode at most one overlay shows. | \[H\] | COGA: Minimize distractions |
| MAP-06 | The selected route is drawn thicker with casing, unselected thinner. Selection is also shown on the card with a check icon and the word Selected. | \[S\] | WCAG 1.4.1 |
| MAP-07 | Map labels essential to the route SHOULD be at least 12 sp and 4.5:1. | \[R\] | WCAG 1.4.3 |

### 2H. Layout and controls

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| LAY-01 | One filled accent button per screen, at the bottom, full width. | \[R\] A clear primary action reduces decision load. | COGA: Help users find what they need |
| LAY-02 | Frequent controls sit in the lower half (thumb reach). Rare controls sit at the top. | \[R\] Hoober (2013), observational study of how people hold phones. | None |
| LAY-03 | Same control, same place, same name on every screen. | \[S\] | WCAG 3.2.3 (AA), 3.2.4 (AA) |
| LAY-04 | The Help button is in the same relative place on every screen. | \[S\] | WCAG 3.2.6 (A) |
| LAY-05 | Irreversible actions (End walk, Delete data, Clear history) need confirmation or undo. | \[S\] | WCAG 3.3.4 (AA); COGA: Help users avoid mistakes |
| LAY-06 | The bottom sheet is half-open by default and expands or collapses by button, not by drag alone. Focus moves into the sheet on open and returns on close. | \[S\] | WCAG 2.5.7, 2.4.3, 2.1.1 |
| LAY-07 | Onboarding is one task per screen, with a step counter. Back preserves answers. | \[R\] | COGA: Ensure processes do not rely on memory; WCAG 3.3.7 |
| LAY-08 | Focus is visible, in logical order, and not obscured. | \[S\] | WCAG 2.4.3, 2.4.7, 2.4.11 |
| LAY-09 | No time limits on setup or planning. Sessions do not expire mid-plan. | \[S\] | WCAG 2.2.1 (A), 2.2.6 (AAA) |
| LAY-10 | Actions fire on pointer release and can be cancelled by moving away. | \[S\] Prevents accidental activation. | WCAG 2.5.2 (A) |

### 2I. Input and errors

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| INP-01 | Visible labels, not placeholders only, with autocomplete attributes. Search tolerates missing Polish diacritics (Lagiewniki finds Łagiewniki). | \[S/H\] | WCAG 3.3.2, 1.3.5 |
| INP-02 | Errors say what happened and what to do, in one sentence, with no blame. They are announced as status messages without moving focus. | \[S\] | WCAG 3.3.1, 3.3.3, 4.1.3 |
| INP-03 | Never ask for the same information twice: Recent and Saved places. Back preserves state. | \[S\] | WCAG 3.3.7 (A) |
| INP-04 | If accounts exist: no cognitive tests to sign in; allow paste, password managers and passkeys. | \[S\] | WCAG 3.3.8 (AA) |
| INP-05 | Destination by voice SHOULD be available. | \[H\] Lowers typing effort. | None |
| INP-06 | Pick on map works by button, crosshair and Confirm, not by long-press alone. | \[S\] | WCAG 2.5.1 |

### 2J. Content and language

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| CNT-01 | Plain language, short sentences, one idea each. Reading level target: lower secondary. Avoid decibel, lux and other jargon. | \[R\] | COGA: Use clear and understandable content; WCAG 3.1.5 (AAA) |
| CNT-02 | No idioms, metaphors or sarcasm. One term per concept. A short glossary lives in Help. | \[R\] Literal language helps many autistic users. | COGA; WCAG 3.1.3 (AAA) |
| CNT-03 | No fear language. Safe MUST NOT be used as a route label or promise. Use factor words (Quietest, Best-lit, Fewest people). | \[H\] The data cannot measure safety, so claims must be labelled as estimates. | None |
| CNT-04 | Icons always paired with text labels, from one icon set. | \[R\] | WCAG 1.1.1; COGA: Help users understand what things are |
| CNT-05 | Unique screen titles and clear headings. | \[S\] | WCAG 2.4.2 (A), 2.4.6 (AA) |
| CNT-06 | Tone is calm, direct and warm. No exclamation marks, no urgency. | \[H\] | COGA: Minimize distractions |

### 2K. Safety framing

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| SAF-01 | Show the estimates disclaimer once, in plain words (Routes are estimates. Data can be missing or out of date.), in onboarding and Help. No legal wall on each screen. | \[H\] | None |
| SAF-02 | Help has a one-tap link to call 112, the EU emergency number. | \[R\] | None |
| SAF-03 | If a walk crosses sunset and Light is set to Prefer well-lit, the result states when it will be dark and marks After sunset on affected segments. | \[H\] | None |
| SAF-04 | Sharing a live trip with a trusted contact is a scope decision. If built, it is opt-in per trip. | \[H\] | GDPR Art. 6 and 7 |

### 2L. Privacy and trust

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| PRV-01 | Collect minimum location data, process on device where possible, and keep nothing beyond the walk unless the user saves a place. | \[S\] | GDPR Art. 5(1)(c), 5(1)(e) |
| PRV-02 | Treat the sensory profile as potentially health-related. Store on device by default. Require explicit consent for any server sync. Get legal review on whether Art. 9 applies. | \[S/R\] A profile can reveal health information. | GDPR Art. 9, 6, 7 |
| PRV-03 | Consent is granular and never pre-ticked. Analytics are off by default. Withdrawing is as easy as giving. | \[S\] | GDPR Art. 7; ePrivacy Directive |
| PRV-04 | User reports contain no identifiers, are rate-limited, are labelled as user reports, and alone never lift a segment from No data to Known. | \[H\] Limits spoofing of safety-relevant data. | None |
| PRV-05 | Settings has one-tap View my data and Delete all my data, with confirmation. | \[S\] | GDPR Art. 15, 17; WCAG 3.3.4 |
| PRV-06 | Publish an accessibility statement with a feedback contact. | \[S\] The EAA requires accessibility information for covered services. Confirm scope and the Polish implementing act with counsel. | EAA (Directive 2019/882); EN 301 549 |

### 2M. Assistive technology

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| AT-01 | Every control exposes name, role and value (toggles: pressed; cards: selected). | \[S\] | WCAG 4.1.2 (A) |
| AT-02 | Status changes (routes updated, offline, reroute offered) use polite live regions without moving focus. | \[S\] | WCAG 4.1.3 (AA) |
| AT-03 | Route cards read as: Route A, quietest, 18 minutes, noise data for 82 percent, selected. | \[S/R\] | WCAG 4.1.2, 1.3.1 |
| AT-04 | Everything works by keyboard and switch access, with no keyboard traps. Esc closes sheets. Character-key shortcuts can be turned off. | \[S\] | WCAG 2.1.1, 2.1.2, 2.1.4 |
| AT-05 | Test with VoiceOver, TalkBack and NVDA or JAWS, and at 200% zoom. | \[S\] | WCAG (all); EN 301 549 |
| AT-06 | Document conformance: WCAG 2.2 AA and EN 301 549. The published EN 301 549 referenced WCAG 2.1 AA at the time of writing, so check for newer versions. | \[S\] | EN 301 549; EAA |

### 2N. Overwhelm relief (I don’t feel well)

A one-tap button for a user who feels overwhelmed and wants to get to somewhere calmer. Design for the worst moment: attention, reading and decision-making may all be impaired. The rules are one tap in, one decision out, always cancellable, honest about what is known, and no medical claims.

A **calm place** is a publicly accessible place, open now, whose data for the relevant factors is Known (or clearly labelled Estimated). Noise must be Quiet and Crowds must be Few people. Light follows the profile: Avoid bright places, No preference, or no profile means not Bright; Prefer well-lit means not Dim.

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| OVW-01 | A button labelled I don’t feel well MUST be available on the main screen, during planning and during a walk, in the same place with the same name. It is an outlined (not filled) pill with an icon and text, at least 56 px high. | \[S/R\] Consistency lets users find it under stress. Outlined style respects the one-accent rule. \[H\] The label is as requested; test it against I need a calm place, because some users may not think of themselves as unwell. | WCAG 3.2.3, 3.2.4, 3.2.6, 2.5.5 (AAA adopted), 1.4.1 |
| OVW-02 | One tap MUST start the search. No questions, no confirmation, no forms, no sign-in. Back or Cancel is always visible, and the action activates on release. | \[R\] Under overwhelm, reading and typing are impaired. The action is low-risk and reversible, so a confirmation only adds load. | WCAG 2.5.2 (A); COGA: Help users avoid mistakes, Minimize distractions |
| OVW-03 | While the feature is active, everything non-essential MUST be suppressed: no banners, prompts or promotions. Sound and haptics only if the user enabled them. Low-stimulation presentation (PER-02) applies for this flow only and is restored afterwards. | \[H\] Reduces load at the moment it matters most. | WCAG 2.3.3 (AAA); COGA: Minimize distractions |
| OVW-04 | Only publicly accessible places that are open now, and stay open for at least \[DATA\] more minutes, MAY be suggested. Never private property or closed venues. The dataset (categories, source, licence, opening hours, update process) is \[DATA\]. | \[S/H\] A suggestion the user cannot actually enter is a failure at a vulnerable moment. | None |
| OVW-05 | Criteria MUST follow the user’s profile as defined above, so a user who prefers well-lit routes is never sent somewhere dark. Secluded places SHOULD be avoided after dark \[DATA\]. | \[R/H\] The same profile must govern routes and calm places. Subject to safeguarding review. | None |
| OVW-06 | The primary result MUST have every relevant factor Known for the current time. If none is within \[DATA\] minutes’ walk, show the nearest Estimated place labelled Estimated: typical for this time, not live. No data MUST NEVER qualify. If nothing qualifies, say We don’t know of a calm place nearby. | \[R\] False reassurance at a vulnerable moment causes harm (Lee and See, 2004). This applies UNC-01 to places. | None (formal). Supports UNC-01 |
| OVW-07 | Rank by walking time first, then calm. The route uses the user’s factors but prioritises arrival time, and extra-time limits are capped at \[DATA\]. Any No data stretch on the way is flagged in text. | \[H\] A short path to relief matters more than an optimal one. | COGA: Help users find what they need |
| OVW-08 | The result screen shows one place: name, type, walking time, distance, and its data state in words (Quiet, few people, dim. Known, updated 2 Oct. Live or Typical for now). Controls: Go there (the one filled accent button), Show another place, Stay here, Call 112, and Call someone if set. | \[R\] One decision, few controls (Hick’s law). | WCAG 1.4.1, 4.1.3; COGA: Minimize distractions |
| OVW-09 | Stay here opens a static calm screen with no map and no animation, one sentence (Take your time. Nothing needs doing.), and options: Find a calm place, Call someone, Call 112. A breathing prompt MAY exist only if user-paced and off by default, with no health claims. | \[H\] Some users will not want to move. Validate with target users. | WCAG 2.3.3; COGA: Minimize distractions |
| OVW-10 | Call 112 MUST be one tap away from the result, the calm screen and guidance, with the copy If you need medical help, call 112. The app MUST NOT diagnose, assess symptoms, or claim to treat or relieve a condition. | \[R/S\] The label I don’t feel well can mean a medical emergency, and the app is a route planner. Legal review: confirm whether any wording could bring the feature under the EU Medical Device Regulation. | None; Regulation (EU) 2017/745 (legal review) |
| OVW-11 | Call someone SHOULD appear if the user has saved a contact in Settings. It opens the phone dialer. The app sends location only if the user opts in each time. | \[R\] Social support is a common coping step. Keep consent explicit. | GDPR Art. 6, 7 |
| OVW-12 | Guidance to a calm place uses Low-stimulation guidance: next step only, large text, no haptics or sound unless enabled, no live-change banners. One exception: if live data shows the destination is no longer calm, show one calm banner offering Another place. Never switch automatically. On arrival: You’re here, with Stay here and Done. | \[H\] | WCAG 2.2.1, 2.3.3, 4.1.3 |
| OVW-13 | If location is unavailable or the device is offline, the button still works: use the last known position if recent and cached calm places if available. Otherwise show the calm screen and Call 112 with We can’t find your location. | \[R\] A relief feature that fails silently is worse than none. | WCAG 3.3.1, 4.1.3 |
| OVW-14 | Use location only for the request. Do not retain it, and do not log presses against an identity. Usage analytics only with consent. After arrival, an optional one-tap Was it calm? (Yes, Somewhat, No, Skip) may be offered the next time the app opens, never during distress. | \[S\] Pressing the button could reveal health-related information. | GDPR Art. 5(1)(c), 9, 7; PRV-04 |

### 2O. Business-submitted places and accessibility features

Businesses can add a place and declare accessibility features, for example quiet hours when the music is turned off. This is **declared** data, not measured data, and the rules below keep it honest. Feature types: Quiet hours (music off, volume reduced), Dim lighting hours, Low-crowd hours, Quiet room or area, and access items (step-free entrance, accessible toilet).

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| BIZ-01 | Submissions MUST be structured: feature type from a fixed list, what changes (Music off, Volume lower, Lights dimmed, Screens off, Fewer customers admitted), a schedule, and an entry condition. Free text is limited to \[DATA\] characters and reviewed. | \[R\] Structured data is checkable, comparable and usable by routing. Free text invites vague marketing claims. | None. Model schedules on schema.org OpeningHoursSpecification or OpenStreetMap opening\_hours; WCAG 3.3.2 for the form |
| BIZ-02 | Claims MUST be observable and specific (Music off), not subjective (Calm atmosphere). Health claims (calming, therapeutic, good for anxiety) are not allowed. | \[H\] Observable claims can be confirmed or disputed by visitors. See OVW-10. | None; legal review (EU MDR) |
| BIZ-03 | Schedules MUST be machine-readable: days, start and end times in Europe/Warsaw, recurrence, one-off exceptions and public holidays. A feature shows as active only if the user’s arrival time falls inside its window. | \[R\] Applies UNC-07 (time-scoping) to places. | None |
| BIZ-04 | Every business-submitted item MUST carry the label Reported by the business, plus a last-confirmed date, on cards, place details and spoken output. | \[R\] Visible provenance supports calibrated trust (Lee and See, 2004). | None. Supports UNC-06 |
| BIZ-05 | Declared data counts as Estimated, never Known. It is promoted to Known only when the business is identity-verified AND \[DATA\] independent visitor confirmations exist within \[DATA\] days. Disputed or expired data is treated as No data and excluded from calm-place suggestions. | \[R/H\] Self-reported claims are unverified. Treating them as Known would break UNC-01 and OVW-06. | None. Supports UNC-01 |
| BIZ-06 | The trust tier (Reported by the business, Confirmed by visitors, Disputed) MUST be shown with text and an icon, not colour alone. | \[S\] | WCAG 1.4.1, 1.4.11 |
| BIZ-07 | The business MUST verify its identity and authority by at least one method \[DATA\], for example a lookup in the Polish business registers (CEIDG, KRS), a code sent to the registered email or phone, or a postal code. One verified owner account per location, with staff roles. | \[H\] Stops impersonation and false listings. | None |
| BIZ-08 | Being suggested as a calm place (F13) needs a separate opt-in, default off. The opt-in explains that distressed visitors may arrive. The business MUST also state its entry condition (Open to anyone, Customers only, Ask staff), which users see. | \[R/H\] Duty of care: businesses should not receive distressed people without consent, and users should not be surprised by a purchase expectation. | None. Links to OVW-04 |
| BIZ-09 | Provide Pause today (switches quiet hours off for the day) and schedule exceptions. Pause MUST take effect within \[DATA\] minutes. | \[R\] Events and staffing change. A stale claim harms the user at the place. | None |
| BIZ-10 | Declarations expire after \[DATA\] days unless re-confirmed. Remind owners before expiry. Expired data becomes No data. | \[R\] Applies UNC-08 to business data. | None. Supports UNC-08 |
| BIZ-11 | Payment MUST NOT influence ranking, calm-place eligibility or trust tier. Any commercial relationship is disclosed. | \[S/R\] Misleading presentation of paid placement can breach consumer law. Check applicability. | Directive 2005/29/EC; Directive (EU) 2019/2161 |
| BIZ-12 | Visitor confirmation is asked only in the arrival flow for that place, in one tap (Was the music off? Yes, No, Not sure, Skip). It stores no user identifier and only adds to aggregate counts. | \[H\] Keeps privacy while giving a verification signal. | GDPR Art. 5(1)(c) |
| BIZ-13 | Any user can flag a listing as Not as described. Repeated or serious disputes suspend the feature pending review. The business is told the reason, can respond and appeal, and decisions are logged. | \[S\] Notice-and-action and reasons for removals. Check which DSA obligations apply, including small-enterprise exemptions. | Digital Services Act, Regulation (EU) 2022/2065, Art. 16, 17, 20 |
| BIZ-14 | Venue features MUST NOT change street-segment noise, light or crowd values, or route ranking. Venue data and street data are separate layers. | \[R/H\] Prevents gaming of routing and keeps street data honest. | None |
| BIZ-15 | Place details show each feature with its window, status now (Active now, until 16:00, or Next: Tue 14:00), provenance, trust tier, entry condition and last-updated date. Map markers use a distinct shape plus icon and are off by default behind Layers. | \[S/R\] | WCAG 1.4.1, 1.4.11; MAP-05; COGA: Help users understand what things are |
| BIZ-16 | The business portal MUST meet WCAG 2.2 AA with the same tokens. No drag-only schedule input, visible labels on all time fields, saved progress, and plain language in Polish, English and Ukrainian. | \[S\] Business staff include disabled people. | WCAG 2.5.7, 3.3.2, 3.3.7, 1.4.3; EN 301 549 |
| BIZ-17 | Collect minimum business contact data. Sole traders’ data is personal data. Published listings show no personal names or direct staff contact. Retention is \[DATA\], with deletion on request. | \[S\] | GDPR Art. 5, 6, 17 |
| BIZ-18 | Businesses that opt in to F13 SHOULD receive a one-page plain-language staff guide: what to do if someone arrives distressed, call 112 for medical emergencies, no diagnosing. | \[H\] | None |
| BIZ-19 | Terms, in plain language, require the business to confirm accuracy and accept that listings can be paused or removed. | \[S\] Legal review needed. | Directive 2005/29/EC |

### 2P. Accuracy votes and verification labels

Users need to judge how far to trust each piece of data. Two things serve that: a verification label with dates, and a simple accuracy vote.

**Demo scope.** For the hackathon demo, build ACC-01 to ACC-05, ACC-07 to ACC-09, ACC-11 and ACC-16. The rest are for production. The Digital Services Act, paid-placement and business-terms items (BIZ-11, BIZ-13, BIZ-19) are production-only and can be skipped in the demo. The honesty rules still apply in the demo, because a wrong label is worse than a missing one.

| ID | Requirement | Rationale and evidence | Standard |
| --- | --- | --- | --- |
| ACC-01 | Every data item a user can act on (a street factor value in the segment sheet, a feature in the place sheet) MUST have a control titled Is this accurate? with two buttons: Accurate (thumbs-up icon) and Not accurate (thumbs-down icon). The text is always visible, never icons alone. | \[R\] Thumbs alone are ambiguous. Words say what the vote means. | WCAG 1.1.1, 1.4.1, 4.1.2; COGA: Help users understand what things are |
| ACC-02 | Buttons are at least 44 by 44 and expose their pressed state. The user can change or remove a vote by tapping again. A polite status says Thanks. Your vote was saved. | \[S\] | WCAG 2.5.5 (AAA adopted), 4.1.2, 4.1.3 |
| ACC-03 | One vote per item per user or device. Votes apply to a version of the item. If the item is edited or re-measured, votes reset and users are told This changed on 4 Oct. Is it still accurate? | \[H\] People should never be counted as agreeing with a claim that changed after they voted. | None |
| ACC-04 | Show counts in words (Accurate 12, Not accurate 3) only once at least \[DATA\] votes exist. Before that show Not enough feedback yet. Do not show percentages for small samples. | \[R\] Small samples mislead, and false precision harms calibrated trust (Lee and See, 2004). | None. Supports UNC-04 |
| ACC-05 | Votes are opinions, not verification. Accurate votes alone MUST NOT change Not verified to Verified or Estimated to Known. Enough Not accurate votes (\[DATA\]) mark the item Disputed and exclude it from calm-place suggestions until reviewed. | \[R/H\] The rule is deliberately asymmetric. False reassurance is worse than false doubt. | None. Supports UNC-01, OVW-06, BIZ-05 |
| ACC-06 | Votes cast right after arriving at a place, or after walking a stretch, SHOULD be tagged Visited and counted separately (Visitors: 5 accurate, 1 not accurate). | \[H\] Presence makes a vote more reliable. Optional in the demo. | None |
| ACC-07 | Every data item MUST show a verification label: Verified or Not verified. Use an icon and text (filled check for Verified, hollow circle for Not verified), never colour alone. | \[S\] | WCAG 1.4.1, 1.4.11 |
| ACC-08 | The label MUST say what it means in one plain sentence available from the label itself. Verified: \[DATA\] (for example, The team checked this on 2 Oct 2026). Not verified: Nobody has checked this yet. Model estimates and business claims start as Not verified. | \[R\] A bare label with no definition is empty and can mislead. | COGA: Use clear and understandable content |
| ACC-09 | Every item MUST show two absolute dates: Posted (or Measured) and Verified. If not verified, show Not yet verified in place of the second date. Format 2 Oct 2026, localised to the user’s language. Relative text (3 days ago) may be added but never replaces the date. Screen readers read the full date. | \[R\] Dates let users judge how current the data is. | COGA: Use clear and understandable content; WCAG 1.3.1 |
| ACC-10 | If the verification date is older than \[DATA\] days, the label becomes Verification out of date and the item counts as Estimated. | \[R\] Applies UNC-08 and BIZ-10 to verification. | None. Supports UNC-08 |
| ACC-11 | Label and data state are separate. Not verified means at most Estimated. Verified means Known only if confidence and freshness thresholds are also met. Never merge them into one badge. | \[R/H\] Two overlapping scores in one badge confuse users. | None. Supports UNC-01 to UNC-03 |
| ACC-12 | Place the label and dates in the segment sheet and place sheet, in this order: provenance, verification label, dates, then the vote control. Route cards MAY show a summary (Verified for 40% of route). | \[H\] Reading order follows trust: where it came from, whether checked, when, then your view. | WCAG 1.3.1, 2.4.3 |
| ACC-13 | No gamification, streaks or prompts to vote. Voting is never required and never blocks anything. | \[H\] | COGA: Minimize distractions |
| ACC-14 | Votes carry no user identifier. The demo may use one anonymous device flag to prevent duplicates. Revisit for production. | \[S\] A device flag can still be personal data. | GDPR Art. 5(1)(c) |
| ACC-15 | Votes are rate-limited per device. Rapid repeated votes are ignored. | \[H\] Basic abuse protection. | None |
| ACC-16 | The team needs a simple way to mark an item Verified with a date and a one-line note, and to clear verification. This also feeds business verification in F15. | \[H\] The demo needs real Verified items to show. | None |

## 3. Design tokens

Contrast ratios were computed with the WCAG relative-luminance formula against each theme background. Recompute before changing any value. Implement tokens as CSS variables or native theme tokens. Follow the device theme by default, with a user override.

**Light theme.** Background #F6F3EE.

| Token | Hex | Use | Contrast on background |
| --- | --- | --- | --- |
| text | #2B2F33 | Body text | 12.2:1 |
| text-muted | #555C63 | Secondary text | 6.1:1 |
| accent | #1F6F78 | Primary button fill, links | 5.3:1 (white text on it: 5.8:1) |
| error | #A4452C | Error text and icon | 5.5:1 |
| border | #8C8579 | Input borders, meaningful dividers | 3.3:1 |
| route-quiet | #2A6F97 | Route A line | 5.0:1 |
| route-lit | #9A5518 | Route B line | 5.2:1 |
| no-data | #6B5B95 | No data dashes and ? marker | 5.3:1 |

**Dark theme.** Background #1B1F23.

| Token | Hex | Use | Contrast on background |
| --- | --- | --- | --- |
| text | #E4E1DA | Body text | 12.7:1 |
| text-muted | #A9B0B7 | Secondary text | 7.6:1 |
| accent | #7CC4CB | Primary button fill, links | 8.4:1 (dark text #1B1F23 on it: 8.4:1) |
| error | #E59A83 | Error text and icon | 7.3:1 |
| border | #6A727A | Input borders, meaningful dividers | 3.4:1 |
| route-quiet | #6FB3E0 | Route A line | 7.3:1 |
| route-lit | #E0A458 | Route B line | 7.6:1 |
| no-data | #B7A8E0 | No data dashes and ? marker | 7.7:1 |

**Still to define at build \[DATA\].** The shortest-route grey (2 px, at least 3:1), the crowd stipple tone and its three density steps (at least 3:1), card surface colours and basemap tones. Compute and record each ratio. Under forced colours, map tokens to system colours and keep dashes, hatching and labels.

## 4. Main screen anatomy

Top to bottom. The map region comes last in reading order, with a skip link past it.

1. **Top bar.** Start and Destination fields, 44 px high with visible labels. Settings and Help buttons at top-right, with Swap below them.
2. **When row.** Segmented control: Now, Leave at. Leave at opens the native time picker.
3. **Map.** Zoom plus and minus on the right. Locate at bottom-right. Legend and Layers at bottom-left. Every control is at least 44 by 44.
4. **Bottom sheet.** Half-open by default, with an expand button.
   - Profile row: Noise, Light (three-state), Crowds, and an Adjust button for strictness and maximum extra time.
   - Compare toggle above the route cards.
   - Route cards (up to three): letter badge, name, time, extra time versus shortest, per-factor level and coverage, and a ? icon when data gaps exist.
   - Start walking: one full-width filled accent button at the bottom.

**Overwhelm button.** I don’t feel well is an outlined pill, 56 px high, with an icon and text. It is anchored to the top edge of the bottom sheet at bottom-centre, between Legend and Layers on the left and Locate on the right, so it stays visible at any sheet height. In the guidance view it sits in the bottom bar beside End walk. Its position and name never change between screens \[OVW-01, LAY-03\]. Below 360 CSS px width, Legend and Layers stack above it.

## 5. User flows

Conventions: requirement IDs appear in square brackets. Quoted-style strings are suggested copy, written to the voice rules in CNT-01 to CNT-06. Every flow must work in light, dark and Low-stimulation modes, and with a screen reader.

### F1. First run and profile setup

**Trigger.** First launch. **Preconditions.** No profile stored.

1. **Splash.** Static logo for at most 1.5 seconds, with no animation \[MOT-05\].
2. **Welcome (Step 1 of 5).** One sentence on what the app does. Buttons: Get started (filled), Skip setup (text), Language (top-right).
3. **Display (Step 2).** The system reads OS settings and states them (We matched your device: dark mode, larger text) \[PER-03\]. Controls: theme, text size slider with live sample, Low-stimulation switch with a one-line description, reduce-motion switch. Each applies instantly.
4. **Profile (Step 3).** Heading: What makes walking harder for you? Toggle rows: Loud streets (Noise) and Crowded places (Crowds). The Light row offers three options: Avoid bright places, Prefer well-lit streets, No preference. Each row has an info control \[FAC-03\]. A None of these, decide later option is available. Strictness defaults to Flexible.
5. **Data gaps (Step 4).** Static legend: a solid line means we have data; a dashed line with ? means No data yet. Copy: Some streets have no data. We mark them clearly and never count them as quiet. Button: Got it \[UNC-09\].
6. **Permissions and privacy (Step 5).** Location permission with the purpose in one sentence, then Allow while using the app or Not now. A plain statement of what stays on the device \[PRV-01, PRV-02\]. An analytics switch, off by default \[PRV-03\].
7. **Finish.** The main screen opens with the profile applied. No coach marks.

**Alternatives and errors.**

- Skip setup: defaults apply (Match device, no factors active). A dismissible banner appears on the first search: Set your profile for routes that fit you.
- Back at any step keeps answers \[INP-03\].
- App closed mid-setup: it resumes at the same step.
- Location denied: manual start entry, and Help explains how to enable location later.
- Unsupported language: falls back to English with a note.

**Accessibility.** Each step has its own heading and focus moves to it on step change. Progress (Step 3 of 5) is exposed to screen readers.

**Done when.** Profile and display settings are saved and the user is on the main screen. Every step after Get started is skippable.

### F2. Plan a route

**Trigger.** The user opens the app or taps Destination. **Preconditions.** Profile loaded. Location may be unavailable.

1. **Main screen.** Calm-style map, centred on the user, or on Rynek Główny if there is no location. On a cold start the Destination field is focused, with Recent places listed below it.
2. **Destination.** Suggestions appear after 2 characters, with Recent and Saved places first. Diacritics are optional \[INP-01\]. Alternatives: Pick on map with crosshair and Confirm \[INP-06\], or voice \[INP-05\].
3. **Start.** Defaults to Your location and is editable.
4. **When.** Now by default. Leave at opens the time picker. For a future time, the sheet states that values are typical for that time \[UNC-07\].
5. **Factors.** Chips show the saved profile. Changing a chip applies to this trip only. After a change, a text button Save as my default appears.
6. **Compute.** A static status says Finding routes, announced politely. After 5 seconds it adds Still working. No shimmer or spinner animation \[MOT-05, AT-02\].
7. **Results.** The sheet half-opens with up to three cards: the best match for the profile (named by factor, for example Quietest), an alternative, and Shortest \[FAC-06 to FAC-08\]. The first card is preselected. Each card shows time, distance, extra time versus shortest, per-factor level and coverage, and a ? icon if gaps exist \[UNC-04\].
8. **Selection.** Tapping a card highlights its route on the map (thicker, with casing). The map fits to the route once, instantly \[MOT-04\].
9. **Decision.** Start walking (F5), or Details (F3, F4).

**Alternatives and errors.**

- No location and no start entered: Enter a start point, with focus on the field.
- Outside coverage: Routes are available in Kraków only.
- Start and destination very close: show the walk time and a single route.
- Ambiguous address: list the matches and let the user pick.
- Large gaps or conflicting factors: see F7.
- Slow or failed compute: Couldn’t find routes. Check your connection and try again, with a Retry button (F10).

**Accessibility.** Reading order: top bar, When, profile row, cards, Start walking, map. Cards read per AT-03. A polite status says 3 routes found.

**Done when.** The user has a selected route and can start walking within four actions from a cold start: type destination, pick suggestion, change the selected card if wanted, Start walking.

### F3. Compare routes and read data coverage

**Trigger.** The user taps Compare or expands the sheet.

1. The sheet expands by button, not drag alone \[LAY-06\].
2. A table shows routes as rows (A, B, Shortest) and columns for time, extra time, then each active factor with level and coverage (Noise: Low, 82% known).
3. Cells with gaps carry the ? icon and words such as No data on 18%.
4. Selecting a row selects that route on the map.
5. Collapsing returns to the half-open sheet and focus returns to the Compare toggle.

**Alternatives.** One active factor: the table shows one factor column. Equal levels: show Similar, not a Best label.

**Accessibility.** A real data table with row and column headers.

**Done when.** The user can say which route has more known data and what each costs in time.

### F4. Inspect a data gap or segment

**Trigger.** The user taps a ? marker, a route segment, or an item in the Stretches with no data list inside Details.

1. The segment sheet opens with street name, length and position on the route.
2. One row per active factor: level word or No data yet; state (Known, Estimated, No data); source; last updated; Live or Typical for the chosen time \[UNC-06, UNC-07\].
3. Actions: Avoid this stretch (recomputes, see F6), Report what you see (F8), Close.
4. Close returns focus to the element that opened the sheet.

**Alternatives and errors.** A segment where every factor is Known shows only Report. If details fail to load: Couldn’t load details for this stretch. Try again.

**Accessibility.** The Stretches with no data list gives non-visual access to the same information \[MAP-01\].

**Done when.** The user can tell which factors are unknown for a stretch and what to do about it.

### F5. Walk a route

**Trigger.** Start walking. **Preconditions.** Location permission granted.

1. **Guidance view.** Next-step text at least 24 sp with distance, a small map, progress, and a status line for the current stretch (Noise: Low. Crowds: Some people, typical).
2. **Cues.** Visual by default. Haptics and sound only if enabled \[PER-01\].
3. **No data stretch ahead.** Calm cue: Next 200 m: no noise data \[UNC-12\].
4. **Live change.** If live crowd or noise data for an upcoming stretch changes materially, a banner offers Reroute or Keep going. It does not auto-dismiss and never reroutes automatically \[LAY-09, MOT-04\].
5. **Off route.** Off route. Reroute? with Reroute and Keep going.
6. **Locked screen.** The next step is shown on the lock screen where the OS permits.
7. **Arrival.** You’ve arrived, with time and distance. Optional feedback, How was this route? with Matched what I expected, Louder, Brighter, Busier, Skip (F8).
8. **End early.** End walk asks for confirmation \[LAY-05\].

**Errors.** GPS lost: Location unavailable. Showing your last known position. Offline: continue on the cached route (F10).

**Accessibility.** Instructions are announced politely, with a Repeat button. The map never auto-scrolls. Low-stimulation mode shows the next step only.

**Done when.** The user reaches the destination or ends the walk, with no route change they did not request.

### F6. Change preferences while planning

**Trigger.** Toggle a chip, change the Light state, open Adjust, or change When.

1. The control changes and routes recompute in place.
2. A polite status says Routes updated. Focus stays on the control.
3. The selected route stays selected if it is still returned. If not, a status says Your selected route changed.
4. The Adjust sheet holds Strictness (Flexible, Strict), Maximum extra time (+5, +10, +20, No limit) and Prefer routes with more data \[FAC-05, UNC-05\].
5. Save as my default is offered after any change.

**Alternatives.** All factors off: results are ranked by distance, with the note No preferences on, so routes are ranked by distance.

**Done when.** The user sees new results and understands what changed.

### F7. Conflicts, sparse data and no route

- **Conflict.** Quietest and best-lit differ. Cards show per-factor trade-offs with no single winner, plus the note Routes trade off against each other \[FAC-06\].
- **Sparse data.** If more than \[DATA\]% of the best route has No data for an active factor, a neutral banner says We have little data on these streets. This route may not match your profile. Actions: Show shortest anyway, Report what you see.
- **Strict mode, nothing within limits.** We couldn’t find a route within your limits. Options: Allow +10 min, Switch to Flexible, Show shortest.
- **Everything unknown.** The same banner appears, ranking falls back to distance, and the app says so \[UNC-05\].

**Done when.** No route is ever presented as quiet or well-lit where the data is missing.

### F8. Report what you see

**Trigger.** The segment sheet, or arrival feedback.

1. Form: factor (Noise, Light, Crowds), level (three levels or Can’t tell), optional note with a reminder not to include personal details.
2. Send. Confirmation: Thanks. Reports are checked before they change a route \[PRV-04\].
3. Rate limit reached: You’ve sent several reports. Try again later.
4. Offline: the report is saved and sent when online, with a status message.

No photos. No account required unless the team decides otherwise \[DATA\].

**Done when.** A report is accepted with no identifying information attached.

### F9. Settings, help and data control

Groups: Display (theme, text size, Low-stimulation, reduce motion); Routing (default factors, strictness, maximum extra time, Prefer routes with more data); Alerts (haptics, sound, in-walk cues); Language; Privacy and data; Help; About.

1. Each control applies instantly with a preview. Each group has Reset to defaults \[PER-01, PER-04\].
2. Help holds Legend, Glossary, FAQ, Contact, Accessibility statement, and Call 112 \[SAF-02, PRV-06\].
3. Privacy and data shows what is stored and where, View my data, an Analytics switch, and Delete all my data. Delete asks for confirmation listing what will go, then states Your data was deleted \[PRV-05\].
4. About lists data sources and the last update date per factor \[UNC-06\].

**Done when.** Any setting can be found, changed and reset, and data can be deleted in two steps.

### F10. Offline and location problems

- **Offline while planning.** Banner: You’re offline. Routes can’t be updated. Saved places and your last route are still available. New searches show Retry.
- **Offline while walking.** The cached route continues, no reroute is offered, and the status says Offline. Showing your saved route.
- **Back online.** A polite status says Back online. No automatic reroute during a walk.
- **Location off or denied.** Location is off. Enter a start point, or turn on location in Settings, with a link.
- **Low accuracy.** Location is approximate, with the radius stated.

**Done when.** The user always knows the connection and location state in words and has a usable way forward.

### F11. Screen reader, keyboard and switch access

1. Headings: h1 Plan a walk; h2 Preferences; h2 Routes; h2 Map. Skip links: Skip to routes, Skip map.
2. Reading order: top bar, When, profile row, cards, Start walking, map controls.
3. Cards use select semantics and read per AT-03. Details opens the segment list.
4. Sheets: focus moves in on open, Esc closes, focus returns to the trigger.
5. Every action is reachable by keyboard or switch. Focus indicator is at least 3:1. No timeouts.
6. While walking, each instruction is announced politely and a Repeat button is available.

**Done when.** A screen-reader user completes F2, F3, F4 and F5 without using the map.

### F12. Return to the app and resume

- **Cold start.** Main screen with Recent places, profile and theme applied.
- **App ended during a walk.** Continue your walk? with Continue and End walk.
- **Backgrounded while planning.** State is kept for \[DATA\] minutes, then resets to saved defaults. Saved settings are never lost.
- **OS theme changes.** If Match device is selected, the theme follows without a flash.

### F13. I don’t feel well: get to a calm place

**Trigger.** The user taps I don’t feel well from the main screen, results, or the guidance view. **Preconditions.** Location permission granted (see alternatives if not).

1. **Tap.** The button activates on release \[LAY-10\]. The screen switches at once to the calm presentation: current theme, muted, no animation, with Back and Call 112 visible. A static line says Finding a calm place near you.
2. **Search.** The system uses the current location and the criteria derived from the profile \[OVW-04, OVW-05, OVW-06\]. No spinner. After 3 seconds the line adds Still looking.
3. **Result.** One place is shown: name, type, walking time and distance, and its status in words (Quiet, few people, dim. Known, updated 2 Oct. Typical for now). Controls: Go there (filled accent), Show another place, Stay here, Call 112, and Call someone if set \[OVW-08\].
4. **Go there.** Guidance starts in Low-stimulation form with arrival time prioritised \[OVW-07, OVW-12\]. The bottom bar keeps Stay here and Call 112. No-data stretches are flagged in text only.
5. **Arrival.** You’re here, with Stay here and Done. Done returns to the main screen, where an optional one-tap Was it calm? may appear on the next app open \[OVW-14\].
6. **Stay here.** The calm screen shows Take your time. Nothing needs doing. Options: Find a calm place, Call someone, Call 112, Back to map \[OVW-09\].

**Alternatives and errors.**

- Show another place: the next candidate appears. After \[DATA\] candidates: We don’t have more nearby.
- No Known place in range: show the nearest Estimated place with its label, or We don’t know of a calm place nearby, plus Stay here and Call 112 \[OVW-06\].
- Place closes soon: exclude it, or warn with the closing time \[OVW-04\].
- Profile prefers well-lit and it is dark: dark or secluded candidates are excluded \[OVW-05\].
- Location off, denied, or offline: follow OVW-13.
- Pressed during a walk: the current route is paused and kept. Return to my route is available at any time.
- Pressed by accident: Back returns to the previous screen with state intact (selected route, When, chips).
- Destination stops being calm (live data): one calm banner offers Another place. No automatic switch \[OVW-12\].

**Accessibility.** The button is announced as I don’t feel well, button. Focus moves to the result heading. The result is read in one sentence: Calm place: \[name\], 6 minutes’ walk. Quiet, few people, dim. Known, updated 2 October.

**Done when.** The user can start navigation in two taps from any screen (the button, then Go there), reach a calm place or stop at any point, and is never sent to a place that is closed, dark against their profile, or based on No data.

### F14. A business registers and lists a place

**Trigger.** A business owner opens the business portal. **Preconditions.** None.

1. **Landing.** One sentence on what the portal does. Buttons: Start (filled), Sign in.
2. **Create account.** Email and password, with paste and password managers allowed \[INP-04\]. A verification email is sent.
3. **Verify the business.** Choose a method \[BIZ-07\]. Status shows Pending until confirmed.
4. **Add the place.** Name, address (autocomplete, then confirm the pin on the map with a button), type, opening hours, and entry condition \[BIZ-08\].
5. **Add accessibility features.** Choose from the fixed list. For each: what changes, and the schedule (days, start and end, recurrence) \[BIZ-01, BIZ-03\]. A preview shows exactly how visitors will see it, including Reported by the business.
6. **Calm-place opt-in.** A separate screen, default off. It explains what opting in means and offers the staff guide \[BIZ-08, BIZ-18\].
7. **Review and submit.** A summary page. The owner ticks a confirmation of accuracy and accepts the terms, then selects Submit \[BIZ-19\].
8. **Confirmation.** Status Pending review, the expected timeline \[DATA\], and a confirmation email.

**Alternatives and errors.**

- Progress is saved at every step and can be resumed \[BIZ-16\].
- Address not found: let the owner place the pin by button, with Back preserved.
- Place already exists: offer Claim this place, which goes through verification.
- Verification fails: say what happened and offer another method.
- Invalid schedule (end before start, overlapping windows): inline error beside the field with the fix.
- Leaving with unsaved changes: ask once, with Save and leave as the default.

**Accessibility.** All fields have visible labels. Time entry has typed fields, with no drag-only calendar. Errors are announced.

**Done when.** The place is submitted, in Pending review, and the owner knows what happens next.

### F15. Review and publish

**Trigger.** A submission or a change to claims.

1. **Automated checks.** Prohibited health claims, subjective wording, duplicate listings, schedule validity.
2. **Human review.** Required for first listings, for new claims, and for calm-place opt-ins.
3. **Outcome.** Published as Reported by the business (Estimated) \[BIZ-05\]; Needs changes, with the reason in plain language; or Rejected, with a reason and an appeal route \[BIZ-13\].
4. **Notification.** The business is told by email and in the portal. Every decision is logged.

**Done when.** The business always knows the status and the reason for any decision.

### F16. Update, pause, expire and remove

- **Pause today.** One prominent button in the portal and in a magic-link email. It takes effect within \[DATA\] minutes \[BIZ-09\].
- **Edit schedule or features.** Changes to claims go back through F15.
- **Exceptions.** One-off closures and holidays can be added in advance.
- **Re-confirm.** Reminders go out at \[DATA\] days and again before expiry. Unconfirmed declarations expire into No data \[BIZ-10\].
- **Remove.** The owner can remove a listing at any time, with a confirmation that states what will go.

**Done when.** The data shown to users never outlasts what the business has confirmed.

### F17. A user finds and uses a business place

**Trigger.** The user turns on Layers, then Quiet places, or searches a place name.

1. **Markers.** Quiet places appear as a distinct shape plus icon. They are off by default \[BIZ-15, MAP-05\].
2. **Place sheet.** Name, type, each feature with its window, status now, provenance, trust tier, entry condition, and last-updated date.
3. **Arrival check.** The sheet compares the estimated arrival time with the window (You’d arrive at 15:20, inside the quiet hours, which end at 16:00). If the window ends before arrival, it says so plainly.
4. **Actions.** Route there (starts F2 with the place as destination), Report a problem (F18).

**Alternatives.** Outside the window: show Next quiet hours. Expired or disputed: show No data yet and no active claim. Closed: say so.

**In F13.** Only opted-in places with an active window at the estimated arrival time are eligible. They appear as Estimated unless promoted to Known, with the entry condition shown \[BIZ-05, BIZ-08, OVW-06\].

**Done when.** The user can see what the business claims, how reliable that is, and whether it will still hold on arrival.

### F18. Visitor feedback and disputes

**Trigger.** Arrival at a business place after routing there, or the Report a problem button.

1. **One-tap feedback.** Was the music off? Yes, No, Not sure, Skip. Asked once, after arrival, never during distress \[BIZ-12, OVW-14\].
2. **Report a problem.** Not as described, closed, unsafe wording, or other, with an optional short note. No personal details \[BIZ-13\].
3. **Processing.** Counts update the trust tier. Repeated or serious reports suspend the feature pending review.
4. **Business response.** The business is notified, can reply, and can appeal.

**Done when.** Feedback is stored without identifiers and can change a listing’s trust tier.

### F19. Check how reliable data is and vote on accuracy

**Trigger.** The user opens a segment sheet (F4) or a place sheet (F17).

1. **Read the label.** The sheet shows, in order: where the data came from, the verification label (Verified or Not verified), and the dates, for example Not verified. Posted 28 Sep 2026. Tapping the label shows its one-sentence meaning \[ACC-07 to ACC-09\].
2. **Vote.** Under it, Is this accurate? with two buttons, Accurate and Not accurate \[ACC-01\].
3. **Accurate.** The button shows a pressed state with a check. A polite status says Thanks. Your vote was saved. Counts appear if enough votes exist \[ACC-02, ACC-04\].
4. **Not accurate.** Same, plus an optional one-tap follow-up: What was wrong? Noise, Light, Crowds, Closed, Hours, Other, Skip. The follow-up feeds F18.
5. **Change or remove.** Tapping the other button changes the vote. Tapping the pressed button removes it.

**Alternatives and errors.**

- Offline: the vote is saved on the device and sent later, with a status message.
- The item changed since the vote: buttons reset and the user sees This changed on 4 Oct. Is it still accurate? \[ACC-03\].
- Rate limit reached: You’ve voted on several items. Try again soon.
- Enough Not accurate votes: the item shows Reported as not accurate. We’ve stopped suggesting it. \[ACC-05\].
- Verification too old: the label reads Verification out of date \[ACC-10\].

**Accessibility.** Buttons are announced as Accurate, toggle button, not pressed. Counts and dates are read in words and in full.

**Done when.** The user can see what was checked and when, can cast or change a vote in one tap, and cannot mistake a vote for a verification.

## 6. Validation and acceptance

- **Automated.** axe-core or Lighthouse for web, Accessibility Scanner for Android, Accessibility Inspector for iOS, and a contrast report for every token pair in both themes.
- **Manual.** VoiceOver, TalkBack and NVDA; 200% text; 320 px reflow; forced colours and increased contrast; colour-vision simulation (protanopia, deuteranopia, tritanopia, achromatopsia); reduced motion; Low-stimulation walkthrough of F1 to F5; keyboard-only and switch access.
- **User testing.** Include autistic and ADHD users, people with migraine, anxiety or PTSD, women who walk at night, people with colour-vision deficiency, screen-reader users and people with mobility needs. Use informed consent, compensation, pause-anytime sessions and a stress self-rating after each task. Group sizes: \[DATA\].
- **Uncertainty comprehension test.** Show a dashed ? stretch and ask, Is this stretch quiet? The correct answer is that it is unknown. Target: at least \[DATA\]% correct. The uncertainty design fails if users read gaps as safe.
- **Other metrics.** Task success for F2, time to Start walking, stress rating, and zero severity-1 accessibility defects.
- **Release gates.** Every MUST row passes. No open WCAG 2.2 AA failures. The comprehension target is met. The accessibility statement is published.

* **Overwhelm feature (F13).** Test with scenario-based tasks only, never by inducing distress. Measure taps and time from the button to Go there, comprehension of the status wording, and a no-data case where the correct outcome is no suggestion. Complete a safeguarding review before release.

- **Business features (F14 to F18).** Usability-test the portal with business owners, including disabled staff. Test that visitors understand Reported by the business as different from Known. Run abuse tests: false claims, mass listings, and review manipulation.

* **Labels and votes (F19).** Test that users read Not verified as unchecked, not as wrong, and Verified as checked, not as perfect. Test that nobody takes vote counts as verification. Check the dates are readable in Polish, English and Ukrainian.

## 7. Open decisions for the team

- Confidence thresholds and staleness limits \[DATA\].
- Crowd data source, live versus typical, and update cadence \[DATA\].
- Coverage boundary of Kraków routing.
- Default maximum extra time.
- Accounts or no accounts, and what syncs.
- Languages beyond Polish, English and Ukrainian.
- Trusted-contact sharing (SAF-04).
- Haptic patterns.
- Legal review: GDPR Art. 9 (PRV-02) and EAA scope (PRV-06).

* Calm-place dataset: categories, source, licence, opening hours and update process \[DATA\].
* Button label: test I don’t feel well against I need a calm place with target users.
* Time targets for OVW-02 and OVW-08 \[DATA\].
* Trusted-contact feature scope (OVW-11).
* Legal review: wording against the EU Medical Device Regulation, duty-of-care risk when directing people to a place, and place-owner terms.
* Safeguarding review for suggesting secluded places after dark (OVW-05).

- Verification method and thresholds for business identity and visitor confirmations (BIZ-05, BIZ-07) \[DATA\].
- Declaration expiry period and reminder schedule (BIZ-10) \[DATA\].
- Whether businesses can pay for anything, and how any commercial relationship is disclosed (BIZ-11).
- Legal review: DSA applicability, consumer-law rules on paid placement, and business terms (BIZ-11, BIZ-13, BIZ-19).
- Whether to accept third-party sensory-friendly certifications as verification evidence \[DATA\].

* What Verified means in the product, who can grant it, and by what method (ACC-08, ACC-16) \[DATA\].
* Vote thresholds: minimum votes before counts show, and the number of Not accurate votes that mark an item Disputed (ACC-04, ACC-05) \[DATA\].
* Demo scope: the DSA, paid-placement and business-terms items are production-only.

## 8. References

- W3C, Web Content Accessibility Guidelines 2.2: https://www.w3.org/TR/WCAG22/
- W3C, Making Content Usable for People with Cognitive and Learning Disabilities (COGA): https://www.w3.org/TR/coga-usable/
- ETSI EN 301 549, accessibility requirements for ICT products and services
- Directive (EU) 2019/882, European Accessibility Act
- Regulation (EU) 2016/679, GDPR
- Lee, J. D. and See, K. A. (2004). Trust in automation: designing for appropriate reliance. Human Factors
- Hoober, S. (2013). How do users really hold mobile devices? UXmatters
- British Dyslexia Association, Dyslexia Friendly Style Guide
- WebAIM, The WebAIM Million annual accessibility analysis
- Colour Blind Awareness, colour blindness statistics
- Apple Human Interface Guidelines; Google Material Design accessibility guidance

# WhyCode interface: Origin

## Product idea

WhyCode is an investigation instrument, not an administrative dashboard. The primary task is to point to a repository, ask a question, and follow its evidence. The interface should make that sequence obvious without filling the page with workspace chrome.

## Identity and composition

The mark is `<?>`: code chevrons with a question mark replacing the slash. It is implemented as a reusable native SVG and as the favicon, not a generated bitmap. The wordmark has no enclosing app tile or decorative status badge.

The page uses charcoal, warm off-white, and a single lime action accent. Large sans typography establishes the question; an italic serif emphasizes the why. Monospace is reserved for source identifiers, controls, and technical annotations. Thin rules replace nested rounded cards. There is no permanent sidebar, avatar, breadcrumb trail, or summary-tile grid.

The homepage pairs a typographic opening with an explicitly illustrated path from implementation to commit to conversation. The repository input is the main functional entry. Once a repository is selected, the layout becomes a reading surface with the answer on the left and a numbered source reader on the right. Repositories and saved investigations live in the Archive drawer, available from either state. The connection view is a navigable SVG topology with an accessible textual equivalent.

## Motion

- Masked heading lines establish the hierarchy on entry.
- SVG paths trace the relationship between code, change, and discussion. A restrained signal moves along the path.
- Intersection-based reveals introduce functional sections as they enter the viewport.
- Tab content and source excerpts transition on actual user selection.
- Buttons show directional feedback; the archive drawer opens spatially from the side.
- Loading remains indeterminate and shows actual elapsed time. No fictitious progress or streamed model text is added.

Motion is CSS-based, with no animation dependency or continuous React render loop. A persistent motion toggle settles the interface into a static state. The OS reduced-motion preference disables animation, and the control cannot override that preference.

## Usability and boundaries

The mobile layout brings repository input before the decorative illustration. On narrow screens, the italic why moves to its own line rather than clipping. Long source lines scroll inside the source reader; maps and tabs can scroll inside their own boundaries. The archive traps keyboard focus and makes the underlying reading surface inert. Source text remains escaped React content, and the existing authentication, safe-link handling, server request controls, and evidence verification paths are retained.

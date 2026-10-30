# WhyCode: a field guide to a codebase

The homepage now unfolds over four chapters: repository entry, connected context, an interactive evidence-reading example, and the return to exploration. At 1440×900, the default closed-example layout is approximately four viewport heights. Larger reading text and a standalone orbital chapter replace the compressed side-by-side first screen. Section links support direct navigation, and the final action scrolls to and focuses the existing URL field.

The answer demonstration is explicitly illustrative. Its source reveal contains the actual displayed example snippet; the alternative question explains that code alone does not establish the team's rationale. It makes no provider calls and does not fabricate results for a real repository. Scroll reveals and orbital motion respect the device reduced-motion preference. The navigation stays visible, with a reading-progress line and a decorative branch companion following scroll progress.

The reference informed the task-first hierarchy, distinctive typography, and graphics that relate to the product. The resulting design uses its own code/history subject matter rather than the reference's telephone graphics or purple palette.

- The repository field is part of the opening composition, with public/private access and history options alongside it.
- Instrument Serif is served locally, with DM Sans for interface and reading text. The downloaded Google Fonts license is retained in `apps/web/public/fonts/instrument-serif-OFL.txt`.
- The illustration is an orbital evidence map: shaded SVG nodes for code, change, and discussion surround the WhyCode mark. CSS perspective provides limited pointer tilt. Selection highlights the corresponding orbit and node, updates an accessible explanation, and supports left/right/Home/End keyboard navigation.
- Pointer tilt is limited to fine mouse input and small angles. Touch users get the same source-type buttons. Device reduced-motion settings disable animation; the graphic does not depend on WebGL or an external renderer.
- The example is labeled as an illustration, never as repository data. The answer's source cards use cited evidence only and open the existing inspector. Missing evidence types are omitted rather than invented.
- Index counts and technical limitations are collapsed under Index details. Running progress and failures remain visible outside that disclosure.

Visual verification covers desktop, mobile, source inspection, index disclosure, orbital node selection, keyboard wraparound, and persistent navigation. Provider, account, repository authorization, and answer generation behavior are unchanged by this presentation work.

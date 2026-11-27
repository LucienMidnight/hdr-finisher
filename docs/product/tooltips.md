# Tooltip editing catalogue

## How to edit

Steve: edit the **Text** cells in place. Keep IDs and source references intact. Edit one workflow or section at a time; save your edited copy before asking an agent to apply it. An agent compares your edited copy with a freshly generated catalogue, locates each ID in the source, applies only your wording changes, checks dynamic branches and shared uses, then regenerates this document. **Do not regenerate over unapplied edits.** The sync test will fail while edits are waiting to be applied; that is expected.

Agent: run `node tools/tooltip-catalogue.cjs > ../docs/product/tooltips.md` from `codebase` after applying edits. Use `--check` to check without writing. The extractor only reads source; it never applies edits or changes the app. IDs prefer element IDs, label targets or data paths; unnamed/generated sites fall back to file and line, so use the saved baseline when code moves.

Dynamic entries show the JavaScript expression/template, with supporting definitions listed nearby. Keep `${…}` placeholders and code intact; edit the words inside quotes. Name-only entries repeat a control, selected option or photo name; changing those may also rename the control itself. Fallback candidates can be overridden by a longer tooltip at runtime.

## Coverage and limits

This inventory contains **817 source entries**, not 817 distinct hover messages. Shared helpers can produce many messages; multiple sources can feed one control. It scans HTML and JavaScript in frontend and the desktop shell (including embedded markup), title/data-tooltip/data-tip/data-native-tooltip attributes and assignments, authored title-tooltip spans, accessible-label fallbacks, and selected-option names. No app or photo is opened.

Runtime names, paths, errors, backend capability messages, custom album/label meanings and selected values have no finite list of text: their expression is recorded. Arbitrary computed property names, new helper APIs, external content and native operating-system menus are not discoverable by this static scanner. Supporting expressions are conservative and may include strings that are not shown as tooltips. When adding a new tooltip mechanism, extend the extractor and its fixture test.

Clipped lane, scope, preview and filename labels use their visible text; dynamic selected options use the selected option text. See `frontend/tooltips.js` for clipping and precedence rules. The catalogue lists authored sources even if hidden or currently overridden. Platform shortcut labels may be translated at runtime by shortcut-labels.js. The historical `docs/design/HDR_Finisher_Tooltip_Copy.md` registry is reference material; this catalogue reflects current source.

## Notes for the editing pass

- Long explanations occur in RAW development, Highlight Compression, Film Look and Export. Consider whether each hover needs every sentence.
- Technical phrases include “endpoint-protected”, demosaic, signal-domain and gamut; related Tone screen-reader hover status also says “neutral-ray” and “limiter”. Check whether a photographer can act on them.
- Tone adds a range-preview explanation and an extra Blacks/Whites gesture note at runtime, making an already long tooltip longer. Edit the base and suffix together.
- HDR and SDR share much wording, but their highlight limits and delivery differ. Compare the HDR and SDR sections before changing either; duplicated entries are flagged.
- Some copy says color and some colour; nit/nits and capitalization also vary.
- Name-only tooltips help with clipped names but offer no explanation. Decide where a short explanation would help.
- Repeated Library/main-window entries and shared helpers need consistent edits; do not accidentally change only one copy.

## Library

### photo library

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Collapse folders | Collapse folders | name only (fallback) | codebase/frontend/photo-library.html::#collapse-left · [source](../../codebase/frontend/photo-library.html#L9) |
| Collapse Folders | Collapse Folders | name only (fallback) | codebase/frontend/photo-library.html:9 · [source](../../codebase/frontend/photo-library.html#L9) |
| Add Folders | Add Folders | fixed; name only | codebase/frontend/photo-library.html::#add-folder · [source](../../codebase/frontend/photo-library.html#L9) |
| Reorder Folders | Drag to reorder section | fixed | codebase/frontend/photo-library.html:9::2 · [source](../../codebase/frontend/photo-library.html#L9) |
| Collapse Albums | Collapse Albums | name only (fallback) | codebase/frontend/photo-library.html:9::3 · [source](../../codebase/frontend/photo-library.html#L9) |
| Add Albums | Add Albums | fixed; name only | codebase/frontend/photo-library.html::#add-album · [source](../../codebase/frontend/photo-library.html#L9) |
| Reorder Albums | Drag to reorder section | fixed | codebase/frontend/photo-library.html:9::4 · [source](../../codebase/frontend/photo-library.html#L9) |
| Collapse Smart Albums | Collapse Smart Albums | name only (fallback) | codebase/frontend/photo-library.html:9::5 · [source](../../codebase/frontend/photo-library.html#L9) |
| Add Smart Albums | Add Smart Albums | fixed; name only | codebase/frontend/photo-library.html::#add-smart-album · [source](../../codebase/frontend/photo-library.html#L9) |
| Reorder Smart Albums | Drag to reorder section | fixed | codebase/frontend/photo-library.html:9::6 · [source](../../codebase/frontend/photo-library.html#L9) |
| Resize folders panel | Resize folders panel | name only (fallback) | codebase/frontend/photo-library.html::#library-left-splitter · [source](../../codebase/frontend/photo-library.html#L10) |
| Grid | Grid · G | fixed | codebase/frontend/photo-library.html::#grid-view · [source](../../codebase/frontend/photo-library.html#L11) |
| Single photo | Single photo · Space | fixed | codebase/frontend/photo-library.html::#single-view · [source](../../codebase/frontend/photo-library.html#L11) |
| Full-screen review | Full-screen review · F | fixed | codebase/frontend/photo-library.html::#review-view · [source](../../codebase/frontend/photo-library.html#L11) |
| div | Thumbnail size | fixed | codebase/frontend/photo-library.html:11 · [source](../../codebase/frontend/photo-library.html#L11) |
| Ascending. Switch to descending | Ascending. Switch to descending | name only (fallback) | codebase/frontend/photo-library.html::#sort-dir · [source](../../codebase/frontend/photo-library.html#L11) |
| Filter | Filter · Ctrl+F | fixed | codebase/frontend/photo-library.html::#filter-button · [source](../../codebase/frontend/photo-library.html#L11) |
| 100% | 100% detail is available in Single photo view · Z | fixed | codebase/frontend/photo-library.html::#zoom-button · [source](../../codebase/frontend/photo-library.html#L11) |
| HDR | Show HDR pictures on an HDR display; switch off for SDR previews · H | fixed | codebase/frontend/photo-library.html::#hdr-button · [source](../../codebase/frontend/photo-library.html#L11) |
| More | More | fixed; name only | codebase/frontend/photo-library.html::#more-button · [source](../../codebase/frontend/photo-library.html#L11) |
| Pop out Library | Open Library in a separate window | fixed | codebase/frontend/photo-library.html::#popout-library · [source](../../codebase/frontend/photo-library.html#L11) |
| Check for new photos | Check this folder and its sub-folders | fixed | codebase/frontend/photo-library.html::#check-photos · [source](../../codebase/frontend/photo-library.html#L11) |
| and up | and up | name only (selected option, when clipped) | codebase/frontend/photo-library.html:12 · [source](../../codebase/frontend/photo-library.html#L12) |
| exactly | exactly | name only (selected option, when clipped) | codebase/frontend/photo-library.html:12::2 · [source](../../codebase/frontend/photo-library.html#L12) |
| and below | and below | name only (selected option, when clipped) | codebase/frontend/photo-library.html:12::3 · [source](../../codebase/frontend/photo-library.html#L12) |
| + Filter | Filter by camera, lens, ISO, date and more | fixed | codebase/frontend/photo-library.html::#filter-add · [source](../../codebase/frontend/photo-library.html#L12) |
| Activity | Library Activity | fixed | codebase/frontend/photo-library.html::#index-status · [source](../../codebase/frontend/photo-library.html#L15) |
| Resize details panel | Resize details panel | name only (fallback) | codebase/frontend/photo-library.html::#library-right-splitter · [source](../../codebase/frontend/photo-library.html#L16) |
| Collapse details | Collapse details | name only (fallback) | codebase/frontend/photo-library.html::#collapse-right · [source](../../codebase/frontend/photo-library.html#L17) |
| note.title | &#96;Shown as ${assumed}. Choose its colour in Grade.&#96; | dynamic expression | codebase/frontend/photo-library.js:640 · [source](../../codebase/frontend/photo-library.js#L640) |
| name.title | photo.name | dynamic expression; name/status supplied at runtime | codebase/frontend/photo-library.js:692 · [source](../../codebase/frontend/photo-library.js#L692) |
| element.title | Online-only. Open this photo to download it. | fixed | codebase/frontend/photo-library.js:824 · [source](../../codebase/frontend/photo-library.js#L824) |
| element aria-label | Photo row loading | name only (fallback candidate) | codebase/frontend/photo-library.js:872 · [source](../../codebase/frontend/photo-library.js#L872) |
| element.title | name | dynamic expression | codebase/frontend/photo-library.js:966 · [source](../../codebase/frontend/photo-library.js#L966) |
| reviewMarks aria-label | Photo marks | name only (fallback candidate) | codebase/frontend/photo-library.js:1231 · [source](../../codebase/frontend/photo-library.js#L1231) |
| button.title | warning.reason | dynamic expression | codebase/frontend/photo-library.js:1239 · [source](../../codebase/frontend/photo-library.js#L1239) |
| next aria-label | Detail preview | name only (fallback candidate) | codebase/frontend/photo-library.js:1474 · [source](../../codebase/frontend/photo-library.js#L1474) |
| .title | place.kind === "smart" ? "Smart album · saved filter across the indexed library" : place.kind === "album" ? "Album. Photos stay where they are." : place.kind ? "Every connected photo that carries this tag" : path | dynamic expression | codebase/frontend/photo-library.js:1623 · [source](../../codebase/frontend/photo-library.js#L1623) |
| path — text used by dynamic tooltips | place.path &#124;&#124; "" | dynamic supporting definition | codebase/frontend/photo-library.js:1601 · [source](../../codebase/frontend/photo-library.js#L1601) |
| expand aria-label | &#96;Expand ${folder.name}&#96; | dynamic expression | codebase/frontend/photo-library.js:1939 · [source](../../codebase/frontend/photo-library.js#L1939) |
| name.title | folder.path | dynamic expression; name/status supplied at runtime | codebase/frontend/photo-library.js:1940 · [source](../../codebase/frontend/photo-library.js#L1940) |
| ) aria-label | &#96;${closed ? "Expand" : "Collapse"} ${side === "left" ? "folders" : "details"}&#96; | dynamic expression | codebase/frontend/photo-library.js:2183 · [source](../../codebase/frontend/photo-library.js#L2183) |
| closed — text used by dynamic tooltips | !(library.classList.contains("library-left-closed") && library.classList.contains("library-right-closed")) | dynamic supporting definition | codebase/frontend/photo-library.js:2656 · [source](../../codebase/frontend/photo-library.js#L2656) |
| library — text used by dynamic tooltips | $("library") | dynamic supporting definition | codebase/frontend/photo-library.js:7 · [source](../../codebase/frontend/photo-library.js#L7) |
| .title | &#96;Sorted by ${item.textContent.toLowerCase()}&#96; | dynamic expression | codebase/frontend/photo-library.js:2212 · [source](../../codebase/frontend/photo-library.js#L2212) |
| item — text used by dynamic tooltips | event.target.closest("[data-sort]") | dynamic supporting definition | codebase/frontend/photo-library.js:2230 · [source](../../codebase/frontend/photo-library.js#L2230) |
| event — text used by dynamic tooltips | JSON.parse(pending.join("")) | dynamic supporting definition | codebase/frontend/photo-library.js:1701 · [source](../../codebase/frontend/photo-library.js#L1701) |
| ) aria-label | label | dynamic expression; name/status supplied at runtime | codebase/frontend/photo-library.js:2215 · [source](../../codebase/frontend/photo-library.js#L2215) |
| label — text used by dynamic tooltips | state.descending ? "Descending. Switch to ascending" : "Ascending. Switch to descending" | dynamic supporting definition | codebase/frontend/photo-library.js:2214 · [source](../../codebase/frontend/photo-library.js#L2214) |
| state — text used by dynamic tooltips | { photos: [], allPhotos: [], reading: false, hdr: false, zoom: false, zoomX: .5, zoomY: .5, zoomScale: 1, native: null, nativeMeta: null, nativeLoading: false, fitMeta: null, displayEpoch: 0, scanError: "", sort: "time", descending: false, filters: {}, index: -1, path: "", view: "grid", review: false, beforeReview: "grid", pins: [], cells: new Map(), filmCells: new Map(), size: 190, selection: new Set(), anchor: -1, scan: null, single: null, active: true, timing: false, picker: null, hiddenFiles: 0, folderSelection: new Set(), folderAnchor: "", collection: null, smartFilters: null, allFacts: false, labelNames: {}, indexing: null } | dynamic supporting definition | codebase/frontend/photo-library.js:8 · [source](../../codebase/frontend/photo-library.js#L8) |
| .title | label | dynamic expression; name/status supplied at runtime | codebase/frontend/photo-library.js:2215::2 · [source](../../codebase/frontend/photo-library.js#L2215) |
| ) aria-label | Dock Library | name only (fallback candidate) | codebase/frontend/photo-library.js:2735 · [source](../../codebase/frontend/photo-library.js#L2735) |
| .title | Return Library to the main window | fixed | codebase/frontend/photo-library.js:2736 · [source](../../codebase/frontend/photo-library.js#L2736) |
| notice.title | job.stage | dynamic expression | codebase/frontend/photo-library.js:2766 · [source](../../codebase/frontend/photo-library.js#L2766) |
| job — text used by dynamic tooltips | jobs.filter(j=&gt;j.path===cell.dataset.path && j.kind!=="quick" && j.reason==="needs more memory").sort((a,b)=&gt;b.estimate-a.estimate)[0] | dynamic supporting definition | codebase/frontend/photo-library.js:2762 · [source](../../codebase/frontend/photo-library.js#L2762) |
| stage — text used by dynamic tooltips | $("single-stage") | dynamic supporting definition | codebase/frontend/photo-library.js:1493 · [source](../../codebase/frontend/photo-library.js#L1493) |
| notice aria-label | job.stage+" Open memory settings" | dynamic expression | codebase/frontend/photo-library.js:2767 · [source](../../codebase/frontend/photo-library.js#L2767) |

### library albums

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| name.title | &#96;Album · ${photos(album.count)}&#96; | dynamic expression | codebase/frontend/library-albums.js:15 · [source](../../codebase/frontend/library-albums.js#L15) |
| photos — text used by dynamic tooltips | count =&gt; &#96;${count.toLocaleString()} ${count === 1 ? "photo" : "photos"}&#96; | dynamic supporting definition | codebase/frontend/library-albums.js:9 · [source](../../codebase/frontend/library-albums.js#L9) |

### library compare

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Side by side | Side by side | name only (selected option, when clipped) | codebase/frontend/library-compare.js:13 · [source](../../codebase/frontend/library-compare.js#L13) |
| Top and bottom | Top and bottom | name only (selected option, when clipped) | codebase/frontend/library-compare.js:13::2 · [source](../../codebase/frontend/library-compare.js#L13) |
| Split | Split | name only (selected option, when clipped) | codebase/frontend/library-compare.js:13::3 · [source](../../codebase/frontend/library-compare.js#L13) |
| button.title | Compare options · C | fixed | codebase/frontend/library-compare.js:11 · [source](../../codebase/frontend/library-compare.js#L11) |
| panel aria-label | Compare options | name only (fallback candidate) | codebase/frontend/library-compare.js:12 · [source](../../codebase/frontend/library-compare.js#L12) |

### library culling

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| stars aria-label | &#96;${value.rating} stars&#96; | dynamic expression | codebase/frontend/library-culling.js:72 · [source](../../codebase/frontend/library-culling.js#L72) |
| copy.title | photo.copy_id ? &#96;Virtual copy: ${photo.copy_name}&#96; : &#96;Has ${photo.copy_count} virtual ${photo.copy_count === 1 ? "copy" : "copies"}&#96; | dynamic expression | codebase/frontend/library-culling.js:77 · [source](../../codebase/frontend/library-culling.js#L77) |
| copy aria-label | copy.title | dynamic expression | codebase/frontend/library-culling.js:78 · [source](../../codebase/frontend/library-culling.js#L78) |
| mark.title | Saved grade | fixed | codebase/frontend/library-culling.js:82 · [source](../../codebase/frontend/library-culling.js#L82) |
| mark aria-label | mark.title | dynamic expression | codebase/frontend/library-culling.js:83 · [source](../../codebase/frontend/library-culling.js#L83) |
| flag aria-label | value.pick === "pick" ? "Picked" : "Rejected" | dynamic expression | codebase/frontend/library-culling.js:87 · [source](../../codebase/frontend/library-culling.js#L87) |
| dot.title | named(value.label) | dynamic expression | codebase/frontend/library-culling.js:91 · [source](../../codebase/frontend/library-culling.js#L91) |
| named — text used by dynamic tooltips | label =&gt; { const name = options.labelName?.(label); return name ? &#96;${name} · ${label} label&#96; : &#96;${label} label&#96;; } | dynamic supporting definition | codebase/frontend/library-culling.js:47 · [source](../../codebase/frontend/library-culling.js#L47) |
| dot aria-label | named(value.label) | dynamic expression | codebase/frontend/library-culling.js:91::2 · [source](../../codebase/frontend/library-culling.js#L91) |
| element aria-label | label | dynamic expression; name/status supplied at runtime | codebase/frontend/library-culling.js:97 · [source](../../codebase/frontend/library-culling.js#L97) |
| element.title | label | dynamic expression; name/status supplied at runtime | codebase/frontend/library-culling.js:97::2 · [source](../../codebase/frontend/library-culling.js#L97) |
| rating aria-label | Star rating | name only (fallback candidate) | codebase/frontend/library-culling.js:105 · [source](../../codebase/frontend/library-culling.js#L105) |
| input aria-label | Add tag · T | name only (fallback candidate) | codebase/frontend/library-culling.js:136 · [source](../../codebase/frontend/library-culling.js#L136) |

### library file commands

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| dialog aria-label | title | dynamic expression; name/status supplied at runtime | codebase/frontend/library-file-commands.js:71 · [source](../../codebase/frontend/library-file-commands.js#L71) |
| select aria-label | Destination folder | name only (fallback candidate) | codebase/frontend/library-file-commands.js:72 · [source](../../codebase/frontend/library-file-commands.js#L72) |
| dialog aria-label | Name clash | name only (fallback candidate) | codebase/frontend/library-file-commands.js:85 · [source](../../codebase/frontend/library-file-commands.js#L85) |

### library filters

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| b aria-label | label | dynamic expression; name/status supplied at runtime | codebase/frontend/library-filters.js:14 · [source](../../codebase/frontend/library-filters.js#L14) |
| label — text used by dynamic tooltips | make("label") | dynamic supporting definition | codebase/frontend/library-filters.js:67 · [source](../../codebase/frontend/library-filters.js#L67) |
| b.title | label | dynamic expression; name/status supplied at runtime | codebase/frontend/library-filters.js:14::2 · [source](../../codebase/frontend/library-filters.js#L14) |
| edit.title | query.describe(rule) | dynamic expression | codebase/frontend/library-filters.js:36 · [source](../../codebase/frontend/library-filters.js#L36) |
| rule — text used by dynamic tooltips | find("rating") | dynamic supporting definition | codebase/frontend/library-filters.js:17 · [source](../../codebase/frontend/library-filters.js#L17) |
| panel aria-label | &#96;Filter by ${field.label}&#96; | dynamic expression | codebase/frontend/library-filters.js:42 · [source](../../codebase/frontend/library-filters.js#L42) |
| input aria-label | field.label | dynamic expression; name/status supplied at runtime | codebase/frontend/library-filters.js:46 · [source](../../codebase/frontend/library-filters.js#L46) |
| box aria-label | item.label | dynamic expression; name/status supplied at runtime | codebase/frontend/library-filters.js:53 · [source](../../codebase/frontend/library-filters.js#L53) |
| input aria-label | &#96;${key === "from" ? "From" : "To"} ${field.label}&#96; | dynamic expression | codebase/frontend/library-filters.js:67::2 · [source](../../codebase/frontend/library-filters.js#L67) |

### library navigation

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| button aria-label | &#96;${body.hidden ? "Expand" : "Collapse"} ${section.querySelector(".library-section-title").textContent}&#96; | dynamic expression | codebase/frontend/library-navigation.js:31 · [source](../../codebase/frontend/library-navigation.js#L31) |
| handle.title | Drag to reorder pinned folder | fixed | codebase/frontend/library-navigation.js:46 · [source](../../codebase/frontend/library-navigation.js#L46) |
| handle aria-label | &#96;Reorder ${row.querySelector(".folder-name").textContent}&#96; | dynamic expression | codebase/frontend/library-navigation.js:46::2 · [source](../../codebase/frontend/library-navigation.js#L46) |

### library overlays

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Clipped highlights | Marks areas where at least one colour channel reached its limit: the camera's recorded white level for RAW, or the file's maximum value for JPEG, PNG and TIFF. Detail in that channel is lost. | fixed | codebase/frontend/library-overlays.js:39 · [source](../../codebase/frontend/library-overlays.js#L39) |
| Near-black shadows | Marks areas that are close to black in every colour channel. Detail there may still be recoverable. | fixed | codebase/frontend/library-overlays.js:39::2 · [source](../../codebase/frontend/library-overlays.js#L39) |
| button.title | kind === "exposure" ? "Show clipped highlights and near-black shadows from the source photo · E" : &#96;${title} options · ${key}&#96; | dynamic expression | codebase/frontend/library-overlays.js:30 · [source](../../codebase/frontend/library-overlays.js#L30) |
| panel aria-label | &#96;${title} options&#96; | dynamic expression | codebase/frontend/library-overlays.js:31 · [source](../../codebase/frontend/library-overlays.js#L31) |
| item.badge.title | m.unavailable | dynamic expression | codebase/frontend/library-overlays.js:108 · [source](../../codebase/frontend/library-overlays.js#L108) |
| item.badge.title | e.message | dynamic expression | codebase/frontend/library-overlays.js:116 · [source](../../codebase/frontend/library-overlays.js#L116) |
| item.badge.title | m.camera_frame_error&#124;&#124;'The camera preview could not be lined up with the sensor data. Develop the photo to see this overlay.' | dynamic expression | codebase/frontend/library-overlays.js:122 · [source](../../codebase/frontend/library-overlays.js#L122) |

### library picture errors

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| dialog aria-label | Library preview error | name only (fallback candidate) | codebase/frontend/library-picture-errors.js:38 · [source](../../codebase/frontend/library-picture-errors.js#L38) |
| cell.element.title | record.reason | dynamic expression | codebase/frontend/library-picture-errors.js:83 · [source](../../codebase/frontend/library-picture-errors.js#L83) |
| tag.title | record.reason | dynamic expression | codebase/frontend/library-picture-errors.js:94 · [source](../../codebase/frontend/library-picture-errors.js#L94) |
| tag aria-label | &#96;${cell.photo.name}: ${record.reason} Review error&#96; | dynamic expression | codebase/frontend/library-picture-errors.js:95 · [source](../../codebase/frontend/library-picture-errors.js#L95) |

### library smart albums

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| s aria-label | label | dynamic expression; name/status supplied at runtime | codebase/frontend/library-smart-albums.js:18 · [source](../../codebase/frontend/library-smart-albums.js#L18) |
| label — text used by dynamic tooltips | make("label","library-filter-value") | dynamic supporting definition | codebase/frontend/library-smart-albums.js:134 · [source](../../codebase/frontend/library-smart-albums.js#L134) |
| name.title | Smart album · saved filter | fixed | codebase/frontend/library-smart-albums.js:28 · [source](../../codebase/frontend/library-smart-albums.js#L28) |
| dialog aria-label | item?"Edit smart album":"New smart album" | dynamic expression | codebase/frontend/library-smart-albums.js:101 · [source](../../codebase/frontend/library-smart-albums.js#L101) |
| name aria-label | Smart album name | name only (fallback candidate) | codebase/frontend/library-smart-albums.js:102 · [source](../../codebase/frontend/library-smart-albums.js#L102) |
| input aria-label | key==="from"?"From":"To" | dynamic expression | codebase/frontend/library-smart-albums.js:136 · [source](../../codebase/frontend/library-smart-albums.js#L136) |
| input aria-label | Rule value | name only (fallback candidate) | codebase/frontend/library-smart-albums.js:140 · [source](../../codebase/frontend/library-smart-albums.js#L140) |
| not aria-label | is not | name only (fallback candidate) | codebase/frontend/library-smart-albums.js:156 · [source](../../codebase/frontend/library-smart-albums.js#L156) |
| remove aria-label | Remove rule | name only (fallback candidate) | codebase/frontend/library-smart-albums.js:157 · [source](../../codebase/frontend/library-smart-albums.js#L157) |

### library tags

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| search aria-label | Find a tag | name only (fallback candidate) | codebase/frontend/library-tags.js:94 · [source](../../codebase/frontend/library-tags.js#L94) |
| list aria-label | Tags | name only (fallback candidate) | codebase/frontend/library-tags.js:101 · [source](../../codebase/frontend/library-tags.js#L101) |
| input aria-label | &#96;Meaning of the ${label} label&#96; | dynamic expression | codebase/frontend/library-tags.js:107 · [source](../../codebase/frontend/library-tags.js#L107) |

## Grade → Global

### grade

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Raw development | Convenience development uses as-shot white balance, AHD demosaic, linear ACES output, and no destructive LibRaw auto brightening or sharpening. The metered starting exposure remains an editable Tone adjustment and is not baked into decoded pixels. | fixed | codebase/frontend/index.html::#raw-settings-toggle · [source](../../codebase/frontend/index.html#L625) |
| Remove hot pixels | Fixes single stuck bright pixels from the sensor. It can occasionally remove a real tiny light, such as a star or a glint, so turn it off for night skies. | fixed | codebase/frontend/index.html:630 · [source](../../codebase/frontend/index.html#L630) |
| Even out harsh specks | Pulls unusual sensor readings toward the local noise range before development. Small stars and thin lettering may soften; colourful blobs can remain. | fixed | codebase/frontend/index.html:631 · [source](../../codebase/frontend/index.html#L631) |
| Speck threshold | Smooth readings beyond this multiple of the local noise range. Lower values are stronger. Applies when you release the slider. | fixed | codebase/frontend/index.html::for=raw-speck-threshold · [source](../../codebase/frontend/index.html#L633) |
| Lens correction | Auto applies only one exact profile match. Off and Manual are always available. | fixed | codebase/frontend/index.html::#lens-settings-note · [source](../../codebase/frontend/index.html#L637) |
| Off | Off | name only (selected option, when clipped) | codebase/frontend/index.html:639 · [source](../../codebase/frontend/index.html#L639) |
| Auto · editable | Auto · editable | name only (selected option, when clipped) | codebase/frontend/index.html:640 · [source](../../codebase/frontend/index.html#L640) |
| Manual profile | Manual profile | name only (selected option, when clipped) | codebase/frontend/index.html:641 · [source](../../codebase/frontend/index.html#L641) |
| Search profiles… | Search profiles… | name only (selected option, when clipped) | codebase/frontend/index.html:646 · [source](../../codebase/frontend/index.html#L646) |
| Edit the HDR version, shown on HDR screens. | Edit the HDR version, shown on HDR screens. | fixed | codebase/frontend/index.html::#hdr-controls-tooltip · [source](../../codebase/frontend/index.html#L973) |
| Edit the SDR version, shown on screens without HDR. | Edit the SDR version, shown on screens without HDR. | fixed | codebase/frontend/index.html::#sdr-controls-tooltip · [source](../../codebase/frontend/index.html#L977) |

### grade / raw-highlights

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Highlight Reconstruction | Repairs clipped RAW color channels before AHD demosaic. Changing this module re-develops the source. | fixed | codebase/frontend/index.html:664 · [source](../../codebase/frontend/index.html#L664) |
| ◉ | Toggle RAW highlight reconstruction | name only (fallback) | codebase/frontend/index.html::#raw-highlight-bypass · [source](../../codebase/frontend/index.html#L666) |
| Opposed color | Opposed color | name only (selected option, when clipped) | codebase/frontend/index.html:672 · [source](../../codebase/frontend/index.html#L672) |
| Edge colour (prototype) | Edge colour (prototype) | name only (selected option, when clipped) | codebase/frontend/index.html:673 · [source](../../codebase/frontend/index.html#L673) |
| Small | A narrow blend just past the clip line. | fixed | codebase/frontend/index.html:686 · [source](../../codebase/frontend/index.html#L686) |
| Medium | The starting point: a moderate blend past the clip line. | fixed | codebase/frontend/index.html:687 · [source](../../codebase/frontend/index.html#L687) |
| Large | A wide blend that melts large clipped lights into their glow. | fixed | codebase/frontend/index.html:688 · [source](../../codebase/frontend/index.html#L688) |
| Expand % | How far the blend reaches past the clip line, as % of the picture's long edge. Each change re-develops the RAW; type a value and press Enter. | fixed | codebase/frontend/index.html:690 · [source](../../codebase/frontend/index.html#L690) |

### grade / denoise

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Denoise | Independent for the active HDR or SDR rendition. Match/Rematch copies the current HDR denoise recipe into SDR once. | fixed | codebase/frontend/index.html:697 · [source](../../codebase/frontend/index.html#L697) |
| ◉ | Toggle Denoise preview | name only (fallback) | codebase/frontend/index.html::#denoise-bypass · [source](../../codebase/frontend/index.html#L699) |
| Show noise | Shows only what Denoise removes, as gray with the removed noise on top. Even grain is safe; visible edges, lettering or texture mean detail is being lost. | fixed | codebase/frontend/index.html::#denoise-show-noise · [source](../../codebase/frontend/index.html#L703) |
| Clean Grain Simple Micro Grain · Experimental | Clean Grain evens out the brightness grain and reduces colour splotches. Simple uses the original noise reduction. | fixed | codebase/frontend/index.html::#denoise-method · [source](../../codebase/frontend/index.html#L707) |
| Clean Grain | Clean Grain | name only (selected option, when clipped) | codebase/frontend/index.html:708 · [source](../../codebase/frontend/index.html#L708) |
| Simple | Simple | name only (selected option, when clipped) | codebase/frontend/index.html:709 · [source](../../codebase/frontend/index.html#L709) |
| Micro Grain · Experimental | Micro Grain · Experimental | name only (selected option, when clipped) | codebase/frontend/index.html:710 · [source](../../codebase/frontend/index.html#L710) |
| Luminance | Reduces brightness noise while keeping a fine grain. | fixed | codebase/frontend/index.html::for=denoise-micro-luminance · [source](../../codebase/frontend/index.html#L716) |
| Color | Reduces colour noise and blotches. | fixed | codebase/frontend/index.html::for=denoise-micro-color · [source](../../codebase/frontend/index.html#L717) |
| Detail | Keeps more texture and edge detail at higher settings. | fixed | codebase/frontend/index.html::for=denoise-micro-detail · [source](../../codebase/frontend/index.html#L718) |
| Luminance | How much brightness noise is removed. Amount scales this and Color Noise together. | fixed | codebase/frontend/index.html::for=denoise-luminance · [source](../../codebase/frontend/index.html#L730) |
| Color Noise | How much colour noise of every size is removed, before splotch cleanup. Amount scales this and Luminance together. Raise it first when colour blotches remain. | fixed | codebase/frontend/index.html::for=denoise-color · [source](../../codebase/frontend/index.html#L731) |
| Grain Evenness | Spreads the remaining brightness grain more evenly. 0% gives Standard’s grain and 100% uses the grain-matched 18-pixel setting. | fixed | codebase/frontend/index.html::for=denoise-evenness · [source](../../codebase/frontend/index.html#L734) |
| Color Splotches | Pulls coloured blotches toward their surroundings while preserving scene brightness. 0% switches off this correction. | fixed | codebase/frontend/index.html::for=denoise-splotches · [source](../../codebase/frontend/index.html#L737) |
| Splotch Size | Small samples colour about 12 pixels away. Large also samples about 28 pixels away to reach beyond wider blotches. | fixed | codebase/frontend/index.html::for=denoise-splotch-size · [source](../../codebase/frontend/index.html#L739) |
| Small | Small | name only (selected option, when clipped) | codebase/frontend/index.html:740 · [source](../../codebase/frontend/index.html#L740) |
| Large | Large | name only (selected option, when clipped) | codebase/frontend/index.html:740::2 · [source](../../codebase/frontend/index.html#L740) |
| Protect color edges | Leave splotch cleanup off sharp colour boundaries that run in a line, so skin, clothing and sky edges keep their colour. Turn off if it leaves splotches near edges. | fixed | codebase/frontend/index.html:742 · [source](../../codebase/frontend/index.html#L742) |
| Clean edge fringes | Reduce narrow colour fringes along bright edges. | fixed | codebase/frontend/index.html:743 · [source](../../codebase/frontend/index.html#L743) |
| Noise size | How strongly each size of noise is removed. 50% is the measured amount; 0% leaves that size alone. Luminance and Color Noise still decide brightness versus colour. | fixed | codebase/frontend/index.html:750 · [source](../../codebase/frontend/index.html#L750) |

### grade / geometry

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Crop | Crop | fixed; name only | codebase/frontend/index.html::#crop-tool-toggle · [source](../../codebase/frontend/index.html#L914) |
| Rotate | Rotate | fixed; name only | codebase/frontend/index.html::#rotate-tool-toggle · [source](../../codebase/frontend/index.html#L915) |
| Free | Free | name only (selected option, when clipped) | codebase/frontend/index.html:920 · [source](../../codebase/frontend/index.html#L920) |
| Original | Original | name only (selected option, when clipped) | codebase/frontend/index.html:920::2 · [source](../../codebase/frontend/index.html#L920) |
| 1:1 | 1:1 | name only (selected option, when clipped) | codebase/frontend/index.html:920::3 · [source](../../codebase/frontend/index.html#L920) |
| 3:2 | 3:2 | name only (selected option, when clipped) | codebase/frontend/index.html:920::4 · [source](../../codebase/frontend/index.html#L920) |
| 2:3 | 2:3 | name only (selected option, when clipped) | codebase/frontend/index.html:920::5 · [source](../../codebase/frontend/index.html#L920) |
| 4:3 | 4:3 | name only (selected option, when clipped) | codebase/frontend/index.html:920::6 · [source](../../codebase/frontend/index.html#L920) |
| 3:4 | 3:4 | name only (selected option, when clipped) | codebase/frontend/index.html:920::7 · [source](../../codebase/frontend/index.html#L920) |
| 5:4 | 5:4 | name only (selected option, when clipped) | codebase/frontend/index.html:920::8 · [source](../../codebase/frontend/index.html#L920) |
| 4:5 | 4:5 | name only (selected option, when clipped) | codebase/frontend/index.html:920::9 · [source](../../codebase/frontend/index.html#L920) |
| 16:9 | 16:9 | name only (selected option, when clipped) | codebase/frontend/index.html:920::10 · [source](../../codebase/frontend/index.html#L920) |
| 9:16 | 9:16 | name only (selected option, when clipped) | codebase/frontend/index.html:920::11 · [source](../../codebase/frontend/index.html#L920) |
| 2:1 | 2:1 | name only (selected option, when clipped) | codebase/frontend/index.html:920::12 · [source](../../codebase/frontend/index.html#L920) |
| Custom | Custom | name only (selected option, when clipped) | codebase/frontend/index.html:920::13 · [source](../../codebase/frontend/index.html#L920) |
| Swap | Swap custom ratio orientation | name only (fallback) | codebase/frontend/index.html::#swap-custom-ratio · [source](../../codebase/frontend/index.html#L925) |
| None | None | name only (selected option, when clipped) | codebase/frontend/index.html:929 · [source](../../codebase/frontend/index.html#L929) |
| Rule of Thirds | Rule of Thirds | name only (selected option, when clipped) | codebase/frontend/index.html:929::2 · [source](../../codebase/frontend/index.html#L929) |
| Golden Ratio | Golden Ratio | name only (selected option, when clipped) | codebase/frontend/index.html:929::3 · [source](../../codebase/frontend/index.html#L929) |
| Grid | Grid | name only (selected option, when clipped) | codebase/frontend/index.html:929::4 · [source](../../codebase/frontend/index.html#L929) |
| X Pattern | X Pattern | name only (selected option, when clipped) | codebase/frontend/index.html:929::5 · [source](../../codebase/frontend/index.html#L929) |
| Diagonal Method | Diagonal Method | name only (selected option, when clipped) | codebase/frontend/index.html:929::6 · [source](../../codebase/frontend/index.html#L929) |

### grade / hdr / hdr-highlights

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle Highlight Compression preview | name only (fallback) | codebase/frontend/index.html:990 · [source](../../codebase/frontend/index.html#L990) |
| Peak | Sets the final peak after grading and finishing. At least 225 nit keeps HDR headroom above project and gain-map reference white. | fixed | codebase/frontend/index.html::for=hdr-compression-target · [source](../../codebase/frontend/index.html#L996) |
| Mode | Peak Fit anchors the measured final-grade peak at the output target. | fixed | codebase/frontend/index.html::#highlight-compression-summary · [source](../../codebase/frontend/index.html#L1007) |
| Peak Fit | Peak Fit | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1010 · [source](../../codebase/frontend/index.html#L1010) |
| Fixed cap | Fixed cap | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1011 · [source](../../codebase/frontend/index.html#L1011) |
| Soft Ceiling | Soft Ceiling | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1011::2 · [source](../../codebase/frontend/index.html#L1011) |
| Clip | Clip | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1012 · [source](../../codebase/frontend/index.html#L1012) |
| Highlight Color | Smooth color rolloff gently compresses each Rec.2020 channel toward white. Preserve color keeps channel ratios intact. Neutralize peak groups channels so the brightest highlights converge to neutral white. Attenuate (prototype) fades bright colours gradually toward white, AgX-style. | fixed | codebase/frontend/index.html::for=hdr-compression-color · [source](../../codebase/frontend/index.html#L1025) |
| Smooth color rolloff | Smooth color rolloff | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1028 · [source](../../codebase/frontend/index.html#L1028) |
| Preserve color | Preserve color | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1029 · [source](../../codebase/frontend/index.html#L1029) |
| Neutralize peak | Neutralize peak | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1030 · [source](../../codebase/frontend/index.html#L1030) |
| Attenuate (AgX-style, prototype) | Attenuate (AgX-style, prototype) | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1031 · [source](../../codebase/frontend/index.html#L1031) |
| Attenuation | How strongly bright colours fade toward white as they are compressed. 0% matches Smooth color rolloff. | fixed | codebase/frontend/index.html::for=hdr-compression-attenuation · [source](../../codebase/frontend/index.html#L1035) |
| Measured maximum | Measured maximum | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1050 · [source](../../codebase/frontend/index.html#L1050) |
| Ignore isolated pixels | Ignore isolated pixels | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1051 · [source](../../codebase/frontend/index.html#L1051) |
| Manual | Manual | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1052 · [source](../../codebase/frontend/index.html#L1052) |

### grade / hdr / hdr-tone

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle Tone preview | name only (fallback) | codebase/frontend/index.html:1070 · [source](../../codebase/frontend/index.html#L1070) |
| Blacks | Lifts or clips the narrow black floor. Tones above the floor are unchanged. Tone ranges are selected before any of the five controls. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-blacks · [source](../../codebase/frontend/index.html#L1089) |
| Shadows | Brightens or darkens the shadow tones. Black stays black. Center and Width choose which tones count as shadows. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-shadows · [source](../../codebase/frontend/index.html#L1094) |
| Range | Shadows range | name only (fallback); duplicated HDR/SDR | codebase/frontend/index.html:1097 · [source](../../codebase/frontend/index.html#L1097) |
| Center | Where the zone sits, in stops from photographic mid-grey: 18% of reference white. Exposure runs first. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-shadows-center · [source](../../codebase/frontend/index.html#L1101) |
| Width | How many stops the zone covers. Its effect fades smoothly at both ends and is gated away from the black floor and white peak. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-shadows-width · [source](../../codebase/frontend/index.html#L1102) |
| Midtones | Brightens or darkens the middle tones. Black and the brightest tones stay where they are. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-midtones · [source](../../codebase/frontend/index.html#L1107) |
| Range | Midtones range | name only (fallback); duplicated HDR/SDR | codebase/frontend/index.html:1110 · [source](../../codebase/frontend/index.html#L1110) |
| Center | Where the zone sits, in stops from photographic mid-grey: 18% of reference white. Exposure runs first. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-midtones-center · [source](../../codebase/frontend/index.html#L1114) |
| Width | How many stops the zone covers. Its effect fades smoothly at both ends and is gated away from the black floor and white peak. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-midtones-width · [source](../../codebase/frontend/index.html#L1115) |
| Highlights | Brightens or darkens the bright tones. The very brightest (sun, reflections) stay put; Highlight Compression looks after those. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-highlights · [source](../../codebase/frontend/index.html#L1120) |
| Range | Highlights range | name only (fallback); duplicated HDR/SDR | codebase/frontend/index.html:1123 · [source](../../codebase/frontend/index.html#L1123) |
| Center | Where the zone sits, in stops from photographic mid-grey: 18% of reference white. Exposure runs first. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-highlights-center · [source](../../codebase/frontend/index.html#L1127) |
| Width | How many stops the zone covers. Its effect fades smoothly at both ends and is gated away from the black floor and white peak. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-highlights-width · [source](../../codebase/frontend/index.html#L1128) |
| Whites | Adjusts the top stop below Target Peak (display white in SDR). Positive values overdrive Film Look; final Highlight Compression still owns the delivery ceiling. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-whites · [source](../../codebase/frontend/index.html#L1132) |

### grade / hdr / hdr-equalizer

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Exposure Bands Default | Adjust exposure by scene brightness. 0 EV is the app's 100-nit diffuse-white reference; the dashed edge marks the 10,000-nit PQ limit. | fixed | codebase/frontend/index.html:1140 · [source](../../codebase/frontend/index.html#L1140) |
| ◉ | Toggle Exposure Bands preview | name only (fallback) | codebase/frontend/index.html:1141 · [source](../../codebase/frontend/index.html#L1141) |
| - | Decrease proportional influence radius | name only (fallback) | codebase/frontend/index.html::#tone-equalizer-radius-down · [source](../../codebase/frontend/index.html#L1150) |
| + | Increase proportional influence radius | name only (fallback) | codebase/frontend/index.html::#tone-equalizer-radius-up · [source](../../codebase/frontend/index.html#L1151) |

### grade / hdr / hdr-color

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle Color preview | name only (fallback) | codebase/frontend/index.html:1170 · [source](../../codebase/frontend/index.html#L1170) |
| Vibrance | Targets lower-chroma colors more strongly and protects colors that are already saturated. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=hdr-vibrance · [source](../../codebase/frontend/index.html#L1188) |

### grade / sdr / sdr-highlights

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle SDR Highlight Compression preview | name only (fallback) | codebase/frontend/index.html:1214 · [source](../../codebase/frontend/index.html#L1214) |
| Match HDR highlight compression | Fits the compression mode and Start to the HDR picture. Leaves other SDR controls unchanged. | fixed | codebase/frontend/index.html::#highlight-match-hdr · [source](../../codebase/frontend/index.html#L1218) |
| Mode | Peak Fit anchors the measured source peak at display white while preserving a smooth highlight gradient. | fixed | codebase/frontend/index.html::#sdr-highlight-compression-summary · [source](../../codebase/frontend/index.html#L1221) |
| Peak Fit | Peak Fit | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1222 · [source](../../codebase/frontend/index.html#L1222) |
| Fixed cap | Fixed cap | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1222::2 · [source](../../codebase/frontend/index.html#L1222) |
| Soft Ceiling | Soft Ceiling | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1222::3 · [source](../../codebase/frontend/index.html#L1222) |
| Clip | Clip | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1222::4 · [source](../../codebase/frontend/index.html#L1222) |
| Highlight Color | Smooth color rolloff gently compresses each sRGB channel toward white. Preserve color keeps channel ratios intact. Neutralize peak groups channels so the brightest highlights converge to neutral white. | fixed | codebase/frontend/index.html::for=sdr-compression-color · [source](../../codebase/frontend/index.html#L1233) |
| Smooth color rolloff | Smooth color rolloff | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1234 · [source](../../codebase/frontend/index.html#L1234) |
| Preserve color | Preserve color | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1234::2 · [source](../../codebase/frontend/index.html#L1234) |
| Neutralize peak | Neutralize peak | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1234::3 · [source](../../codebase/frontend/index.html#L1234) |
| Attenuate (AgX-style, prototype) | Attenuate (AgX-style, prototype) | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1234::4 · [source](../../codebase/frontend/index.html#L1234) |
| Attenuation | How strongly bright colours fade toward white as they are compressed. 0% matches per-channel rolloff. | fixed | codebase/frontend/index.html::for=sdr-compression-attenuation · [source](../../codebase/frontend/index.html#L1237) |
| Measured maximum | Measured maximum | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1249 · [source](../../codebase/frontend/index.html#L1249) |
| Ignore isolated pixels | Ignore isolated pixels | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1249::2 · [source](../../codebase/frontend/index.html#L1249) |
| Manual | Manual | name only (selected option, when clipped); duplicated HDR/SDR | codebase/frontend/index.html:1249::3 · [source](../../codebase/frontend/index.html#L1249) |

### grade / sdr / sdr-tone

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle SDR Tone preview | name only (fallback) | codebase/frontend/index.html:1266 · [source](../../codebase/frontend/index.html#L1266) |
| Match HDR tone | Fits Exposure, Contrast and Exposure Bands to the HDR picture. Leaves other SDR modules unchanged. | fixed | codebase/frontend/index.html::#tone-match-hdr · [source](../../codebase/frontend/index.html#L1270) |
| Blacks | Lifts or clips the narrow black floor. Tones above the floor are unchanged. Tone ranges are selected before any of the five controls. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-blacks · [source](../../codebase/frontend/index.html#L1286) |
| Shadows | Brightens or darkens the shadow tones. Black stays black. Center and Width choose which tones count as shadows. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-shadows · [source](../../codebase/frontend/index.html#L1291) |
| Range | Shadows range | name only (fallback); duplicated HDR/SDR | codebase/frontend/index.html:1294 · [source](../../codebase/frontend/index.html#L1294) |
| Center | Where the zone sits, in stops from photographic mid-grey: 18% of reference white. Exposure runs first. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-shadows-center · [source](../../codebase/frontend/index.html#L1298) |
| Width | How many stops the zone covers. Its effect fades smoothly at both ends and is gated away from the black floor and white peak. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-shadows-width · [source](../../codebase/frontend/index.html#L1299) |
| Midtones | Brightens or darkens the middle tones. Black and the brightest tones stay where they are. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-midtones · [source](../../codebase/frontend/index.html#L1304) |
| Range | Midtones range | name only (fallback); duplicated HDR/SDR | codebase/frontend/index.html:1307 · [source](../../codebase/frontend/index.html#L1307) |
| Center | Where the zone sits, in stops from photographic mid-grey: 18% of reference white. Exposure runs first. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-midtones-center · [source](../../codebase/frontend/index.html#L1311) |
| Width | How many stops the zone covers. Its effect fades smoothly at both ends and is gated away from the black floor and white peak. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-midtones-width · [source](../../codebase/frontend/index.html#L1312) |
| Highlights | Brightens or darkens the bright tones. The very brightest (sun, reflections) stay put; Highlight Compression looks after those. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-highlights · [source](../../codebase/frontend/index.html#L1317) |
| Range | Highlights range | name only (fallback); duplicated HDR/SDR | codebase/frontend/index.html:1320 · [source](../../codebase/frontend/index.html#L1320) |
| Center | Where the zone sits, in stops from photographic mid-grey: 18% of reference white. Exposure runs first. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-highlights-center · [source](../../codebase/frontend/index.html#L1324) |
| Width | How many stops the zone covers. Its effect fades smoothly at both ends and is gated away from the black floor and white peak. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-highlights-width · [source](../../codebase/frontend/index.html#L1325) |
| Whites | Adjusts the top stop below Target Peak (display white in SDR). Positive values overdrive Film Look; final Highlight Compression still owns the delivery ceiling. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-whites · [source](../../codebase/frontend/index.html#L1329) |

### grade / sdr / sdr-equalizer

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Exposure Bands Default | Adjust the tone-mapped SDR image by brightness. Bands are relative to 18% display-linear gray; values above 100% are clipped by the SDR output. | fixed | codebase/frontend/index.html:1337 · [source](../../codebase/frontend/index.html#L1337) |
| ◉ | Toggle SDR Exposure Bands preview | name only (fallback) | codebase/frontend/index.html:1338 · [source](../../codebase/frontend/index.html#L1338) |
| &minus; | Decrease SDR Exposure Band influence | name only (fallback) | codebase/frontend/index.html::#sdr-tone-equalizer-radius-down · [source](../../codebase/frontend/index.html#L1351) |
| + | Increase SDR Exposure Band influence | name only (fallback) | codebase/frontend/index.html::#sdr-tone-equalizer-radius-up · [source](../../codebase/frontend/index.html#L1352) |

### grade / sdr / sdr-color

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle SDR Color preview | name only (fallback) | codebase/frontend/index.html:1364 · [source](../../codebase/frontend/index.html#L1364) |
| Vibrance | Targets lower-chroma colors more strongly and protects colors that are already saturated. | fixed; duplicated HDR/SDR | codebase/frontend/index.html::for=sdr-vibrance · [source](../../codebase/frontend/index.html#L1377) |

### grade / hsl

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Toggle HSL preview | Turn HSL on or off without changing its settings. | fixed | codebase/frontend/index.html:1401 · [source](../../codebase/frontend/index.html#L1401) |
| Reset | Restore all HSL channels to their starting settings. | fixed | codebase/frontend/index.html::#hsl-reset · [source](../../codebase/frontend/index.html#L1402) |
| Match HDR HSL | Copies the current HDR HSL settings once, including on/off. | fixed | codebase/frontend/index.html::#hsl-match-hdr · [source](../../codebase/frontend/index.html#L1405) |

### grade / curves

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle Curves preview | name only (fallback) | codebase/frontend/index.html:1411 · [source](../../codebase/frontend/index.html#L1411) |
| Match HDR curves | Copies the current HDR curve points and on/off. HDR and SDR curves share the same scale. | fixed | codebase/frontend/index.html::#curves-match-hdr · [source](../../codebase/frontend/index.html#L1415) |

### grade / color-grading

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle Color Grading preview | name only (fallback) | codebase/frontend/index.html:1435 · [source](../../codebase/frontend/index.html#L1435) |

### grade / black-and-white

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Black & White | Converts this rendition to black & white. Turn it on with the eye; the sliders set how bright each colour becomes in grey. With every slider at 0 it matches Saturation -100. | fixed | codebase/frontend/index.html:1451 · [source](../../codebase/frontend/index.html#L1451) |
| ◉ | Toggle Black & White | name only (fallback) | codebase/frontend/index.html:1452 · [source](../../codebase/frontend/index.html#L1452) |

### grade / detail

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Detail | Scale-selective detail: fine texture, mid-scale clarity, qualified edges, and an overall softness and microcontrast. | fixed | codebase/frontend/index.html:1478 · [source](../../codebase/frontend/index.html#L1478) |
| ◉ | Toggle Detail preview | name only (fallback) | codebase/frontend/index.html:1479 · [source](../../codebase/frontend/index.html#L1479) |
| Softness | Softens hard digital edges across the whole picture, in colour. Runs after local adjustments, before grain. | fixed | codebase/frontend/index.html::for=detail-softness · [source](../../codebase/frontend/index.html#L1488) |
| Microcontrast | Lowers or raises fine local contrast across the whole picture, in colour. It works differently from Texture. Runs after local adjustments, before grain. | fixed | codebase/frontend/index.html::for=detail-microcontrast · [source](../../codebase/frontend/index.html#L1489) |
| Sharpen | Judge sharpening at 100% zoom. | fixed | codebase/frontend/index.html::for=detail-sharpen · [source](../../codebase/frontend/index.html#L1492) |

### grade / film-look

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle Film Look preview | name only (fallback) | codebase/frontend/index.html:1505 · [source](../../codebase/frontend/index.html#L1505) |
| Film stock | The stock supplies colour, tone, grain, halation and matching paper. Slide films scan directly without a print. | fixed | codebase/frontend/index.html:1514 · [source](../../codebase/frontend/index.html#L1514) |
| Neutral | Neutral | name only (selected option, when clipped) | codebase/frontend/index.html:1514::2 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Portra 400 | Kodak Portra 400 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::3 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Portra 160 | Kodak Portra 160 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::4 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Portra 800 | Kodak Portra 800 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::5 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Ektar 100 | Kodak Ektar 100 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::6 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Gold 200 | Kodak Gold 200 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::7 · [source](../../codebase/frontend/index.html#L1514) |
| Fujifilm Pro 400H | Fujifilm Pro 400H | name only (selected option, when clipped) | codebase/frontend/index.html:1514::8 · [source](../../codebase/frontend/index.html#L1514) |
| Fujifilm C200 | Fujifilm C200 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::9 · [source](../../codebase/frontend/index.html#L1514) |
| Fujifilm Provia 100F | Fujifilm Provia 100F | name only (selected option, when clipped) | codebase/frontend/index.html:1514::10 · [source](../../codebase/frontend/index.html#L1514) |
| Fujifilm Velvia 100 | Fujifilm Velvia 100 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::11 · [source](../../codebase/frontend/index.html#L1514) |
| Fujifilm Superia X-Tra 400 | Fujifilm Superia X-Tra 400 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::12 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Ektachrome 100 | Kodak Ektachrome 100 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::13 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Kodachrome 64 | Kodak Kodachrome 64 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::14 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Ultramax 400 | Kodak Ultramax 400 | name only (selected option, when clipped) | codebase/frontend/index.html:1514::15 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Verita 200D | Kodak Verita 200D | name only (selected option, when clipped) | codebase/frontend/index.html:1514::16 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Vision3 200T | Kodak Vision3 200T | name only (selected option, when clipped) | codebase/frontend/index.html:1514::17 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Vision3 250D | Kodak Vision3 250D | name only (selected option, when clipped) | codebase/frontend/index.html:1514::18 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Vision3 500T | Kodak Vision3 500T | name only (selected option, when clipped) | codebase/frontend/index.html:1514::19 · [source](../../codebase/frontend/index.html#L1514) |
| Kodak Vision3 50D | Kodak Vision3 50D | name only (selected option, when clipped) | codebase/frontend/index.html:1514::20 · [source](../../codebase/frontend/index.html#L1514) |

### grade / film-look / camera

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Format | Controls physical enlargement for halation, resolution, and grain. Grain uses one shared deterministic HDR/SDR field and is added in the negative, before print. | fixed | codebase/frontend/index.html:1517 · [source](../../codebase/frontend/index.html#L1517) |
| 65mm | 65mm | name only (selected option, when clipped) | codebase/frontend/index.html:1517::2 · [source](../../codebase/frontend/index.html#L1517) |
| 35mm | 35mm | name only (selected option, when clipped) | codebase/frontend/index.html:1517::3 · [source](../../codebase/frontend/index.html#L1517) |
| Super 35 | Super 35 | name only (selected option, when clipped) | codebase/frontend/index.html:1517::4 · [source](../../codebase/frontend/index.html#L1517) |
| Super 16 | Super 16 | name only (selected option, when clipped) | codebase/frontend/index.html:1517::5 · [source](../../codebase/frontend/index.html#L1517) |
| 16mm | 16mm | name only (selected option, when clipped) | codebase/frontend/index.html:1517::6 · [source](../../codebase/frontend/index.html#L1517) |
| Super 8 | Super 8 | name only (selected option, when clipped) | codebase/frontend/index.html:1517::7 · [source](../../codebase/frontend/index.html#L1517) |
| Custom | Custom | name only (selected option, when clipped) | codebase/frontend/index.html:1517::8 · [source](../../codebase/frontend/index.html#L1517) |
| Capture | Strip modes anchor the cross-scan dimension for stitched and linescan images. | fixed | codebase/frontend/index.html:1518 · [source](../../codebase/frontend/index.html#L1518) |
| Frame | Frame | name only (selected option, when clipped) | codebase/frontend/index.html:1518::2 · [source](../../codebase/frontend/index.html#L1518) |
| Horizontal strip | Horizontal strip | name only (selected option, when clipped) | codebase/frontend/index.html:1518::3 · [source](../../codebase/frontend/index.html#L1518) |
| Vertical strip | Vertical strip | name only (selected option, when clipped) | codebase/frontend/index.html:1518::4 · [source](../../codebase/frontend/index.html#L1518) |
| Film Exposure | Exposes the negative brighter or darker before printing, which moves the picture along the stock's curve. | fixed | codebase/frontend/index.html::for=film-stock-exposure · [source](../../codebase/frontend/index.html#L1524) |
| None | None | name only (selected option, when clipped) | codebase/frontend/index.html:1525 · [source](../../codebase/frontend/index.html#L1525) |
| Black Pro-Mist | Black Pro-Mist | name only (selected option, when clipped) | codebase/frontend/index.html:1525::2 · [source](../../codebase/frontend/index.html#L1525) |
| Pro-Mist | Pro-Mist | name only (selected option, when clipped) | codebase/frontend/index.html:1525::3 · [source](../../codebase/frontend/index.html#L1525) |
| Glimmerglass | Glimmerglass | name only (selected option, when clipped) | codebase/frontend/index.html:1525::4 · [source](../../codebase/frontend/index.html#L1525) |
| CineBloom | CineBloom | name only (selected option, when clipped) | codebase/frontend/index.html:1525::5 · [source](../../codebase/frontend/index.html#L1525) |

### grade / film-look / negative

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Stock Color | How much of the stock's color is used. At 0 your own color is kept. | fixed | codebase/frontend/index.html::for=film-stock-color · [source](../../codebase/frontend/index.html#L1531) |
| Stock Tone | How much of the stock's contrast curve is used. At 0 your own tone is kept. | fixed | codebase/frontend/index.html::for=film-stock-tone · [source](../../codebase/frontend/index.html#L1532) |
| Color Separation | Pushes the stock's colors further apart, or closer together, in the negative. Greys are unchanged. | fixed | codebase/frontend/index.html::for=film-stock-separation · [source](../../codebase/frontend/index.html#L1535) |
| Show halation map | Shows where the halation glow can appear, as a grayscale map. It shows placement, not strength: Amount and Hue do not change it. Preview only: never exported. | fixed | codebase/frontend/index.html::data-path=current.film_look.halation_view_map · [source](../../codebase/frontend/index.html#L1539) |
| Show grain map | Shows the grain field alone on mid-gray, at the strength each tone of the picture receives. Preview only: never exported. | fixed | codebase/frontend/index.html::data-path=current.film_look.grain_view_map · [source](../../codebase/frontend/index.html#L1552) |
| Film Type | Color negative builds grain from three dye layers of different sizes. Black & white uses one layer of sharper silver grains and has no color grain. | fixed | codebase/frontend/index.html:1554 · [source](../../codebase/frontend/index.html#L1554) |
| Color negative | Color negative | name only (selected option, when clipped) | codebase/frontend/index.html:1554::2 · [source](../../codebase/frontend/index.html#L1554) |
| Black & white | Black & white | name only (selected option, when clipped) | codebase/frontend/index.html:1554::3 · [source](../../codebase/frontend/index.html#L1554) |

### grade / film-look / development

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Push/Pull | Whole stops. Portra 800 +1 and +2 use measured profiles; all other settings approximate development using film contrast. | fixed | codebase/frontend/index.html::for=film-push_pull · [source](../../codebase/frontend/index.html#L1570) |

### grade / film-look / print

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Stock’s own paper | Stock’s own paper | name only (selected option, when clipped) | codebase/frontend/index.html:1574 · [source](../../codebase/frontend/index.html#L1574) |
| Kodak 2383 | Kodak 2383 | name only (selected option, when clipped) | codebase/frontend/index.html:1574::2 · [source](../../codebase/frontend/index.html#L1574) |
| Fujifilm Crystal Archive Type II | Fujifilm Crystal Archive Type II | name only (selected option, when clipped) | codebase/frontend/index.html:1574::3 · [source](../../codebase/frontend/index.html#L1574) |
| Print Exposure | More light on the paper makes a darker print; independent of Film Exposure. | fixed | codebase/frontend/index.html::for=film-print_exposure · [source](../../codebase/frontend/index.html#L1575) |
| Print Warmth | The enlarger's yellow filter: warmer or cooler prints. 100% is a 20 CC filter. | fixed | codebase/frontend/index.html::for=film-stock-warmth · [source](../../codebase/frontend/index.html#L1576) |
| Print Tint | The enlarger's magenta filter. 100% is a 20 CC filter. | fixed | codebase/frontend/index.html::for=film-stock-tint · [source](../../codebase/frontend/index.html#L1577) |
| Preflash | Flashes the print paper with light, lifting and softening the shadows. | fixed | codebase/frontend/index.html::for=film-stock-preflash · [source](../../codebase/frontend/index.html#L1578) |
| Print Contrast | Contrast of the paper itself; independent of Film Exposure. | fixed | codebase/frontend/index.html::for=film-print_contrast · [source](../../codebase/frontend/index.html#L1579) |
| Shadow Contrast | Changes the paper layers that carry scene shadows. | fixed | codebase/frontend/index.html::for=film-shadow_contrast · [source](../../codebase/frontend/index.html#L1580) |
| Highlight Contrast | Changes the paper layers that carry highlights. Negative values also soften the shoulder through developer exhaustion. | fixed | codebase/frontend/index.html::for=film-highlight_contrast · [source](../../codebase/frontend/index.html#L1581) |

### grade / film-look / scan

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Scan Sharpening | Sharpens the completed scan, including grain, before Look Strength mixes it with your picture. Starts off; 70 matches spektrafilm’s amount. Unlike Detail, it sharpens all colours without restricting itself to stronger edges. | fixed | codebase/frontend/index.html::for=film-scan_sharpening · [source](../../codebase/frontend/index.html#L1585) |

### grade / vignette

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ◉ | Toggle Vignette preview | name only (fallback) | codebase/frontend/index.html:1593 · [source](../../codebase/frontend/index.html#L1593) |
| Show overlay | Outlines where the vignette starts and where it reaches full strength. Preview only: never exported. | fixed | codebase/frontend/index.html::#vignette-show-overlay · [source](../../codebase/frontend/index.html#L1598) |
| current.vignette.midpoint | Sets where the vignette starts. 100% reaches near the corners of a 3:2 frame; values up to 200% push it beyond the frame. Roundness and Scale also change its reach. | fixed | codebase/frontend/index.html::data-path=current.vignette.midpoint · [source](../../codebase/frontend/index.html#L1601) |

### color wheels

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| tabs aria-label | Color wheel range | name only (fallback candidate) | codebase/frontend/color-wheels.js:6 · [source](../../codebase/frontend/color-wheels.js#L6) |
| tab aria-label | &#96;${container.dataset.wheel}${modified ? ", modified" : ""}&#96; | dynamic expression | codebase/frontend/color-wheels.js:119 · [source](../../codebase/frontend/color-wheels.js#L119) |

### denoise ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| option.title | unavailable | dynamic expression | codebase/frontend/denoise-ui.js:149 · [source](../../codebase/frontend/denoise-ui.js#L149) |

### geometry tools

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| handle aria-label | &#96;${orientation} guide ${guideIndex + 1} ${pointName}. Use arrow keys to move; Shift moves ten pixels.&#96; | dynamic expression | codebase/frontend/geometry-tools.js:450 · [source](../../codebase/frontend/geometry-tools.js#L450) |
| geometryReset.title | Reset all Crop & Rotate values | fixed | codebase/frontend/geometry-tools.js:1336 · [source](../../codebase/frontend/geometry-tools.js#L1336) |
| geometryReset aria-label | Reset all Crop & Rotate values | name only (fallback candidate) | codebase/frontend/geometry-tools.js:1337 · [source](../../codebase/frontend/geometry-tools.js#L1337) |

### grade paste

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| box aria-label | Preparing photos for paste | name only (fallback candidate) | codebase/frontend/grade-paste.js:89 · [source](../../codebase/frontend/grade-paste.js#L89) |
| dialog aria-label | &#96;Paste Grade From ${clipboard.name}&#96; | dynamic expression | codebase/frontend/grade-paste.js:146 · [source](../../codebase/frontend/grade-paste.js#L146) |
| mode aria-label | Side selection | name only (fallback candidate) | codebase/frontend/grade-paste.js:162 · [source](../../codebase/frontend/grade-paste.js#L162) |
| input aria-label | &#96;${group.lane &#124;&#124; ''} ${group.label}&#96;.trim() | dynamic expression | codebase/frontend/grade-paste.js:184 · [source](../../codebase/frontend/grade-paste.js#L184) |
| input aria-label | &#96;${lane ? lane.toUpperCase() + ' ' : ''}${title}&#96; | dynamic expression | codebase/frontend/grade-paste.js:205 · [source](../../codebase/frontend/grade-paste.js#L205) |
| title — text used by dynamic tooltips | make('h2', '', 'Paste grade') | dynamic supporting definition | codebase/frontend/grade-paste.js:148 · [source](../../codebase/frontend/grade-paste.js#L148) |

### grade saving

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| revertPopover aria-label | Revert grade | name only (fallback candidate) | codebase/frontend/grade-saving.js:269 · [source](../../codebase/frontend/grade-saving.js#L269) |

### highlight controls

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| label.dataset.tooltip | &#96;Sets the final peak after grading and finishing. Minimum ${minimum} nit keeps HDR headroom above project reference white and the gain-map format's 203-nit white (rounded to 25 nit). Dark pictures may still have no HDR rendition.&#96; | dynamic expression | codebase/frontend/highlight-controls.js:13 · [source](../../codebase/frontend/highlight-controls.js#L13) |
| els.highlightCompressionSummary.dataset.tooltip | Compression is off. The ultraviolet identity line leaves highlights unchanged. | fixed | codebase/frontend/highlight-controls.js:239 · [source](../../codebase/frontend/highlight-controls.js#L239) |
| els.highlightCompressionSummary.dataset.tooltip | Fixed cap leaves values below Start unchanged and smoothly compresses brighter colours toward Target Peak, preserving colour ratios without measuring the image peak. | fixed | codebase/frontend/highlight-controls.js:241 · [source](../../codebase/frontend/highlight-controls.js#L241) |
| els.highlightCompressionSummary.dataset.tooltip | &#96;Clip applies a hard final-output ceiling at ${Math.round(hdr.highlight_compression_target_nits)} nit.&#96; | dynamic expression | codebase/frontend/highlight-controls.js:243 · [source](../../codebase/frontend/highlight-controls.js#L243) |
| els.highlightCompressionSummary.dataset.tooltip | &#96;Soft Ceiling approaches ${Math.round(hdr.highlight_compression_target_nits)} nit without a hard peak anchor.&#96; | dynamic expression | codebase/frontend/highlight-controls.js:245 · [source](../../codebase/frontend/highlight-controls.js#L245) |
| els.highlightCompressionSummary.dataset.tooltip | &#96;Peak Fit anchors the measured final-grade peak near ${Math.round(info.target)} nit${adjusted ? &#96;; the curve fit widens the shoulder to ${Math.round(effective)} nit&#96; : ""}${colorNote}.&#96; | dynamic expression | codebase/frontend/highlight-controls.js:257 · [source](../../codebase/frontend/highlight-controls.js#L257) |
| colorNote — text used by dynamic tooltips | sdr.highlight_compression_color_handling === "agx_attenuate" ? &#96; Bright colours fade gradually toward white (Attenuation ${Math.round(sdr.highlight_compression_attenuation ?? 20)}%).&#96; : sdr.highlight_compression_color_handling === "path_to_white" ? " Brightest highlights converge to neutral white." : sdr.highlight_compression_color_handling === "preserve_color" ? " Color ratios are preserved." : " sRGB channels roll off independently for smooth color transitions." | dynamic supporting definition | codebase/frontend/highlight-controls.js:366 · [source](../../codebase/frontend/highlight-controls.js#L366) |
| els.sdrHighlightCompressionSummary.dataset.tooltip | mode === "fixed_cap" ? "Fixed cap leaves values below Start unchanged and smoothly compresses brighter colours toward display white, preserving colour ratios without measuring the image peak." : mode === "clip" ? "Clip applies a hard ceiling at display white." : mode === "soft_ceiling" ? "Soft Ceiling approaches display white without a measured peak anchor." : &#96;Peak Fit places the measured ${Math.round(sourcePeak)}% input peak at display white.${colorNote}&#96; | dynamic expression | codebase/frontend/highlight-controls.js:373 · [source](../../codebase/frontend/highlight-controls.js#L373) |
| mode — text used by dynamic tooltips | sdr.highlight_compression_mode &#124;&#124; "peak_fit" | dynamic supporting definition | codebase/frontend/highlight-controls.js:307 · [source](../../codebase/frontend/highlight-controls.js#L307) |

### hsl panel

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Reset channel | Restore this channel’s starting settings. | fixed | codebase/frontend/hsl-panel.js:43 · [source](../../codebase/frontend/hsl-panel.js#L43) |
| Delete | Delete this custom channel and its adjustment. | fixed | codebase/frontend/hsl-panel.js:44 · [source](../../codebase/frontend/hsl-panel.js#L44) |
| Pick | Click or drag on the photo to replace the colour selection. | fixed | codebase/frontend/hsl-panel.js:47 · [source](../../codebase/frontend/hsl-panel.js#L47) |
| Add | Click or drag on the photo to include more colours. | fixed | codebase/frontend/hsl-panel.js:48 · [source](../../codebase/frontend/hsl-panel.js#L48) |
| Subtract | Click or drag on the photo to exclude colours from the selection. | fixed | codebase/frontend/hsl-panel.js:49 · [source](../../codebase/frontend/hsl-panel.js#L49) |
| Stop picking | Stop sampling colours from the photo. | fixed | codebase/frontend/hsl-panel.js:50 · [source](../../codebase/frontend/hsl-panel.js#L50) |
| Show selection | Show where the active selection applies. Stronger overlay means more coverage. | fixed | codebase/frontend/hsl-panel.js:51 · [source](../../codebase/frontend/hsl-panel.js#L51) |
| input.dataset.tooltip | hslSliderTips[key] | dynamic expression | codebase/frontend/hsl-panel.js:59 · [source](../../codebase/frontend/hsl-panel.js#L59) |
| hslSliderTips — text used by dynamic tooltips | { width: 'Widen the band of colours that get the full adjustment.', feather: 'Higher values blend the adjustment into more neighbouring hues.', edge_feather: 'Higher values spread the fade farther across the photo at selection edges.', edge: 'Negative values shrink selected areas. Positive values grow them.', edge_detail: 'Higher values follow light and dark edges more closely. Lower values smooth over texture.', hue: 'Shift selected colours around the wheel. Positive and negative values turn in opposite directions.', saturation: 'Raise to make selected colours richer. Lower to mute them.', luminance: 'Raise to brighten selected colours. Lower to darken them.', uniformity: 'Raise to pull selected colours closer to the middle of their hue range.', opacity: 'Raise to apply more of the adjustment. Zero turns its effect off.', } | dynamic supporting definition | codebase/frontend/hsl-panel.js:24 · [source](../../codebase/frontend/hsl-panel.js#L24) |
| button aria-label | global?&#96;${ch.name} channel&#96;:&#96;${ch.name} quick start&#96; | dynamic expression | codebase/frontend/hsl-panel.js:183 · [source](../../codebase/frontend/hsl-panel.js#L183) |
| button.dataset.tooltip | global ? ch.kind==='all' ? 'Adjust all colours together.' : &#96;Adjust the ${ch.name.toLowerCase()} colour band.&#96; : &#96;Use ${ch.name.toLowerCase()} as a starting colour for Pick, Add or Subtract.&#96; | dynamic expression | codebase/frontend/hsl-panel.js:187 · [source](../../codebase/frontend/hsl-panel.js#L187) |
| b.dataset.tooltip | Edit this custom colour selection. | fixed | codebase/frontend/hsl-panel.js:198 · [source](../../codebase/frontend/hsl-panel.js#L198) |
| add.dataset.tooltip | add.disabled?'All four Custom channels are in use.':'Create a separate channel for colours you pick.' | dynamic expression | codebase/frontend/hsl-panel.js:200 · [source](../../codebase/frontend/hsl-panel.js#L200) |
| group.dataset.tooltip | handleTips[kind.replace(/-?1$/, '')] | dynamic expression | codebase/frontend/hsl-panel.js:241 · [source](../../codebase/frontend/hsl-panel.js#L241) |
| handleTips — text used by dynamic tooltips | { move: 'Drag to move the whole band to another colour.', edge: 'Drag to widen or narrow the band of fully selected colours.', feather: 'Drag to change how far the selection fades into nearby hues.', target: 'Drag to shift the selected colours toward this hue.', } | dynamic supporting definition | codebase/frontend/hsl-panel.js:234 · [source](../../codebase/frontend/hsl-panel.js#L234) |
| target — text used by dynamic tooltips | event.target.closest('[data-hsl-handle]') | dynamic supporting definition | codebase/frontend/hsl-panel.js:273 · [source](../../codebase/frontend/hsl-panel.js#L273) |

### sdr match ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| ? data-tooltip | Uses HDR tone, colour, local adjustments and Film Look. SDR output exposure and Highlight Compression stay separate. Editing other SDR controls unlinks this photo. | fixed | codebase/frontend/sdr-match-ui.js:14 · [source](../../codebase/frontend/sdr-match-ui.js#L14) |
| unlink data-tooltip | Returns to the independent SDR grade. Match SDR tries to link again. Undo restores the link. | fixed | codebase/frontend/sdr-match-ui.js:26 · [source](../../codebase/frontend/sdr-match-ui.js#L26) |
| input aria-label | SDR output exposure in stops | name only (fallback candidate) | codebase/frontend/sdr-match-ui.js:37 · [source](../../codebase/frontend/sdr-match-ui.js#L37) |
| input data-tooltip | Changes SDR brightness after the shared HDR Film Look. Keeps this photo linked. | fixed | codebase/frontend/sdr-match-ui.js:38 · [source](../../codebase/frontend/sdr-match-ui.js#L38) |
| button data-tooltip | explanation | dynamic expression | codebase/frontend/sdr-match-ui.js:247 · [source](../../codebase/frontend/sdr-match-ui.js#L247) |
| explanation — text used by dynamic tooltips | state.adjustments?.sdr?.linked_to_hdr ? "Fits this adjustment in independent SDR. A changed result unlinks this photo; no change keeps the link. The mask stays unchanged." : "Matches this adjustment only. Global grade and mask stay unchanged." | dynamic supporting definition | codebase/frontend/sdr-match-ui.js:243 · [source](../../codebase/frontend/sdr-match-ui.js#L243) |
| button aria-label | &#96;Match SDR for ${local?.name &#124;&#124; "selected adjustment"}&#96; | dynamic expression | codebase/frontend/sdr-match-ui.js:248 · [source](../../codebase/frontend/sdr-match-ui.js#L248) |

### tone preview ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| caption.textContent | &#96;${explanation}\n${message}&#96; | dynamic expression; related hover status (screen reader) | codebase/frontend/tone-preview-ui.js:179 · [source](../../codebase/frontend/tone-preview-ui.js#L179) |
| explanation — text used by dynamic tooltips | &#96;${name} · Pre-look neutral-ray range${selected.local ? " before spatial mask" : ""} · limiter ${Math.round(limiter * 100)}%${selected.local ? &#96; · opacity ${Math.round(selected.opacity * 100)}%&#96; : ""}&#96; | dynamic supporting definition | codebase/frontend/tone-preview-ui.js:172 · [source](../../codebase/frontend/tone-preview-ui.js#L172) |
| caption.textContent | &#96;${explanation}\nClipping preview unavailable; range remains available.&#96; | dynamic expression; related hover status (screen reader) | codebase/frontend/tone-preview-ui.js:182 · [source](../../codebase/frontend/tone-preview-ui.js#L182) |
| caption.textContent | &#96;${explanation} · ${window.HDRShortcuts.isMac() ? "Option" : "Alt"}-drag Blacks or Whites for clipping&#96; | dynamic expression; related hover status (screen reader) | codebase/frontend/tone-preview-ui.js:185 · [source](../../codebase/frontend/tone-preview-ui.js#L185) |
| label.dataset.tooltip | &#96;${label.dataset.tooltip &#124;&#124; ""} Hover or drag to see the effective, endpoint-protected range on the histogram.${gesture}&#96;.trim() | dynamic expression | codebase/frontend/tone-preview-ui.js:229 · [source](../../codebase/frontend/tone-preview-ui.js#L229) |
| gesture — text used by dynamic tooltips | ["blacks", "whites"].includes(selected.zone) && selected.dimension === "amount" ? &#96; ${window.HDRShortcuts.isMac() ? "Option" : "Alt"}-drag to inspect finished clipping. Whites: black background, white where all channels clip. Blacks: white background, black where all channels crush. RGB and mixed colours show which channels reach the endpoint.&#96; : "" | dynamic supporting definition | codebase/frontend/tone-preview-ui.js:226 · [source](../../codebase/frontend/tone-preview-ui.js#L226) |
| zone — text used by dynamic tooltips | includeZoneHeading ? element.closest("[data-zone-hover]") : null | dynamic supporting definition | codebase/frontend/tone-preview-ui.js:23 · [source](../../codebase/frontend/tone-preview-ui.js#L23) |

## Grade → Local

### grade / local-adjustments

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Brush | New brush adjustment | fixed | codebase/frontend/index.html:788 · [source](../../codebase/frontend/index.html#L788) |
| Gradient | New linear gradient adjustment | fixed | codebase/frontend/index.html:790 · [source](../../codebase/frontend/index.html#L790) |
| Hue | New hue range adjustment | fixed | codebase/frontend/index.html:791 · [source](../../codebase/frontend/index.html#L791) |
| Luma | New luma range adjustment | fixed | codebase/frontend/index.html:792 · [source](../../codebase/frontend/index.html#L792) |
| Path | New path adjustment | fixed | codebase/frontend/index.html:793 · [source](../../codebase/frontend/index.html#L793) |
| Show overlay | Show mask overlay | name only (fallback) | codebase/frontend/index.html::#local-show-mask · [source](../../codebase/frontend/index.html#L796) |
| Overlay color | Choose overlay color | name only (fallback) | codebase/frontend/index.html::#local-overlay-color-button · [source](../../codebase/frontend/index.html#L798) |
| ◉ | Toggle Local Adjustments | name only (fallback) | codebase/frontend/index.html::#local-adjustments-bypass · [source](../../codebase/frontend/index.html#L803) |
| Duplicate | Duplicate selected local adjustment | fixed | codebase/frontend/index.html::#local-duplicate · [source](../../codebase/frontend/index.html#L814) |
| Remove selected local adjustment | Remove selected local adjustment | fixed; name only | codebase/frontend/index.html::#local-delete · [source](../../codebase/frontend/index.html#L815) |
| Move local adjustment up | Move local adjustment up | fixed; name only | codebase/frontend/index.html::#local-move-up · [source](../../codebase/frontend/index.html#L817) |
| Move local adjustment down | Move local adjustment down | fixed; name only | codebase/frontend/index.html::#local-move-down · [source](../../codebase/frontend/index.html#L818) |
| Match SDR | Matches this adjustment only. Global grade and mask stay unchanged. | fixed | codebase/frontend/index.html::#local-sdr-match · [source](../../codebase/frontend/index.html#L829) |

### grade / local-adjustments / light

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Range | Shadows range | name only (fallback); duplicated HDR/SDR | codebase/frontend/index.html:844 · [source](../../codebase/frontend/index.html#L844) |
| Range | Midtones range | name only (fallback); duplicated HDR/SDR | codebase/frontend/index.html:854 · [source](../../codebase/frontend/index.html#L854) |
| Range | Highlights range | name only (fallback); duplicated HDR/SDR | codebase/frontend/index.html:864 · [source](../../codebase/frontend/index.html#L864) |

### grade / local-adjustments / hsl

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| On | Turn local HSL on or off without changing its settings. | fixed | codebase/frontend/index.html::#local-hsl-bypass · [source](../../codebase/frontend/index.html#L885) |
| Reset | Clear this local HSL selection and its adjustments. | fixed | codebase/frontend/index.html::#local-hsl-reset · [source](../../codebase/frontend/index.html#L885) |

### grade / local-adjustments / detail

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Sharpen | Judge sharpening at 100% zoom. | fixed | codebase/frontend/index.html:893 · [source](../../codebase/frontend/index.html#L893) |

### local adjustments ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| button.title | button.dataset.creationTitle | dynamic expression | codebase/frontend/local-adjustments-ui.js:519 · [source](../../codebase/frontend/local-adjustments-ui.js#L519) |
| input aria-label | Local adjustment name | name only (fallback candidate) | codebase/frontend/local-adjustments-ui.js:649 · [source](../../codebase/frontend/local-adjustments-ui.js#L649) |
| bypassButton aria-label | &#96;${enabled ? "Bypass" : "Show"} ${title}&#96; | dynamic expression | codebase/frontend/local-adjustments-ui.js:725 · [source](../../codebase/frontend/local-adjustments-ui.js#L725) |
| title — text used by dynamic tooltips | pending?.name &#124;&#124; (subMask ? &#96;Sub-mask ${subMaskRows(local.mask).findIndex((entry) =&gt; entry.id === subMask.id) + 1}&#96; : local.name) | dynamic supporting definition | codebase/frontend/local-adjustments-ui.js:709 · [source](../../codebase/frontend/local-adjustments-ui.js#L709) |
| bypassButton.title | &#96;${enabled ? "Bypass" : "Show"} ${title}&#96; | dynamic expression | codebase/frontend/local-adjustments-ui.js:727 · [source](../../codebase/frontend/local-adjustments-ui.js#L727) |
| menuButton aria-label | &#96;More actions for ${title}&#96; | dynamic expression | codebase/frontend/local-adjustments-ui.js:733 · [source](../../codebase/frontend/local-adjustments-ui.js#L733) |
| menuButton.title | &#96;More actions for ${title}&#96; | dynamic expression | codebase/frontend/local-adjustments-ui.js:737 · [source](../../codebase/frontend/local-adjustments-ui.js#L737) |
| menu aria-label | &#96;Actions for ${title}&#96; | dynamic expression | codebase/frontend/local-adjustments-ui.js:745 · [source](../../codebase/frontend/local-adjustments-ui.js#L745) |
| summary.title | count ? &#96;${count} modified controls&#96; : "Default" | dynamic expression | codebase/frontend/local-adjustments-ui.js:1112 · [source](../../codebase/frontend/local-adjustments-ui.js#L1112) |
| summary aria-label | summary.title | dynamic expression | codebase/frontend/local-adjustments-ui.js:1112::2 · [source](../../codebase/frontend/local-adjustments-ui.js#L1112) |

### mask controls

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| paintErase aria-label | Brush operation | name only (fallback candidate) | codebase/frontend/mask-controls.js:48 · [source](../../codebase/frontend/mask-controls.js#L48) |
| modeSwitch aria-label | Path boundary to edit | name only (fallback candidate) | codebase/frontend/mask-controls.js:108 · [source](../../codebase/frontend/mask-controls.js#L108) |
| nodeModes aria-label | Selected node profile | name only (fallback candidate) | codebase/frontend/mask-controls.js:147 · [source](../../codebase/frontend/mask-controls.js#L147) |
| button.title | nodeType === "sharp" ? "Retract handles and make a sharp corner" : "Create a continuous smooth tangent" | dynamic expression | codebase/frontend/mask-controls.js:155 · [source](../../codebase/frontend/mask-controls.js#L155) |
| presetGrid aria-label | False-color luminance ranges | name only (fallback candidate) | codebase/frontend/mask-controls.js:290 · [source](../../codebase/frontend/mask-controls.js#L290) |
| input aria-label | labels[index] | dynamic expression | codebase/frontend/mask-controls.js:314 · [source](../../codebase/frontend/mask-controls.js#L314) |
| labels — text used by dynamic tooltips | ["Lower reference-nit edge", "Upper reference-nit edge"] | dynamic supporting definition | codebase/frontend/mask-controls.js:309 · [source](../../codebase/frontend/mask-controls.js#L309) |
| output.title | label | dynamic expression; name/status supplied at runtime | codebase/frontend/mask-controls.js:337 · [source](../../codebase/frontend/mask-controls.js#L337) |
| input aria-label | label | dynamic expression; name/status supplied at runtime | codebase/frontend/mask-controls.js:363 · [source](../../codebase/frontend/mask-controls.js#L363) |
| output.title | label | dynamic expression; name/status supplied at runtime | codebase/frontend/mask-controls.js:390 · [source](../../codebase/frontend/mask-controls.js#L390) |
| input aria-label | handleLabels[index] | dynamic expression | codebase/frontend/mask-controls.js:539 · [source](../../codebase/frontend/mask-controls.js#L539) |
| handleLabels — text used by dynamic tooltips | ["Dark fade", "Dark full", "Light full", "Light fade"] | dynamic supporting definition | codebase/frontend/mask-controls.js:522 · [source](../../codebase/frontend/mask-controls.js#L522) |
| output.title | label | dynamic expression; name/status supplied at runtime | codebase/frontend/mask-controls.js:560 · [source](../../codebase/frontend/mask-controls.js#L560) |
| input.title | ({edge: "Grow or shrink the selected area.", edge_feather: "Soften the selection boundary.", edge_detail: "Smooth across texture or follow light and dark edges."})[name] &#124;&#124; labelText | dynamic expression | codebase/frontend/mask-controls.js:615 · [source](../../codebase/frontend/mask-controls.js#L615) |
| Foldout title | note | dynamic expression | codebase/frontend/mask-controls.js:599 · [source](../../codebase/frontend/mask-controls.js#L599) |

### mask overlay

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| legend aria-label | Mask comparison colors | name only (fallback candidate) | codebase/frontend/mask-overlay.js:4 · [source](../../codebase/frontend/mask-overlay.js#L4) |

## Grade → Retouch

### Retouch

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| New Inpaint repair | New Inpaint repair | fixed; name only | codebase/frontend/index.html::#retouch-mode-inpaint · [source](../../codebase/frontend/index.html#L770) |
| New Heal repair | New Heal repair | fixed; name only | codebase/frontend/index.html::#retouch-mode-heal · [source](../../codebase/frontend/index.html#L771) |
| New Clone repair | New Clone repair | fixed; name only | codebase/frontend/index.html::#retouch-mode-clone · [source](../../codebase/frontend/index.html#L772) |
| Standard inpaint | Standard inpaint | name only (selected option, when clipped) | codebase/frontend/index.html:774 · [source](../../codebase/frontend/index.html#L774) |
| Edge feather · prototype | Edge feather · prototype | name only (selected option, when clipped) | codebase/frontend/index.html:774::2 · [source](../../codebase/frontend/index.html#L774) |
| Preserve original texture · prototype | Preserve original texture · prototype | name only (selected option, when clipped) | codebase/frontend/index.html:774::3 · [source](../../codebase/frontend/index.html#L774) |
| Replace texture from donors · prototype | Replace texture from donors · prototype | name only (selected option, when clipped) | codebase/frontend/index.html:774::4 · [source](../../codebase/frontend/index.html#L774) |

### retouch ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| toggle aria-label | &#96;${record.enabled ? "Hide" : "Show"} ${record.name}&#96; | dynamic expression | codebase/frontend/retouch-ui.js:203 · [source](../../codebase/frontend/retouch-ui.js#L203) |
| record — text used by dynamic tooltips | { id, name: &#96;Spot ${records.length+1}&#96;, enabled: true, recipe: retouchRecipe(points) } | dynamic supporting definition | codebase/frontend/retouch-ui.js:614 · [source](../../codebase/frontend/retouch-ui.js#L614) |
| retry.title | Try another repair | fixed | codebase/frontend/retouch-ui.js:211 · [source](../../codebase/frontend/retouch-ui.js#L211) |
| retry aria-label | &#96;Retry ${record.name}&#96; | dynamic expression | codebase/frontend/retouch-ui.js:212 · [source](../../codebase/frontend/retouch-ui.js#L212) |
| remove.title | Remove repair | fixed | codebase/frontend/retouch-ui.js:222 · [source](../../codebase/frontend/retouch-ui.js#L222) |
| remove aria-label | &#96;Remove ${record.name}&#96; | dynamic expression | codebase/frontend/retouch-ui.js:223 · [source](../../codebase/frontend/retouch-ui.js#L223) |

## Proof

### proof

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| HDR | Review the graded HDR rendition. Chromium Proof renders on this lane. | fixed | codebase/frontend/index.html:370 · [source](../../codebase/frontend/index.html#L370) |
| SDR | Review the SDR fallback. Chromium Proof pauses here and resumes on HDR. | fixed | codebase/frontend/index.html:371 · [source](../../codebase/frontend/index.html#L371) |
| Show Chromium proof | Renders the actual delivered file through this app's Chromium HDR pipeline. | fixed | codebase/frontend/index.html:373 · [source](../../codebase/frontend/index.html#L373) |
| Show Proof watermark | Labels the proof directly on the image. | fixed | codebase/frontend/index.html:377 · [source](../../codebase/frontend/index.html#L377) |
| JPEG Ultra HDR | JPEG Ultra HDR | name only (selected option, when clipped) | codebase/frontend/index.html:384 · [source](../../codebase/frontend/index.html#L384) |
| AVIF + gain map | AVIF + gain map | name only (selected option, when clipped) | codebase/frontend/index.html:385 · [source](../../codebase/frontend/index.html#L385) |
| JPEG XL HDR | JPEG XL HDR | name only (selected option, when clipped) | codebase/frontend/index.html:386 · [source](../../codebase/frontend/index.html#L386) |
| Proof size Reduced · 1,200 px Full size · export pixels | Reduced builds quickly from a downscaled source. Full size encodes the same pixels the export writes and takes about twice as long as an export. | fixed | codebase/frontend/index.html:389 · [source](../../codebase/frontend/index.html#L389) |
| Reduced · 1,200 px | Reduced · 1,200 px | name only (selected option, when clipped) | codebase/frontend/index.html:391 · [source](../../codebase/frontend/index.html#L391) |
| Full size · export pixels | Full size · export pixels | name only (selected option, when clipped) | codebase/frontend/index.html:392 · [source](../../codebase/frontend/index.html#L392) |
| Auto · current display | Auto · current display | name only (selected option, when clipped) | codebase/frontend/index.html:397 · [source](../../codebase/frontend/index.html#L397) |
| 400 nits | 400 nits | name only (selected option, when clipped) | codebase/frontend/index.html:398 · [source](../../codebase/frontend/index.html#L398) |
| 600 nits | 600 nits | name only (selected option, when clipped) | codebase/frontend/index.html:399 · [source](../../codebase/frontend/index.html#L399) |
| 1,000 nits | 1,000 nits | name only (selected option, when clipped) | codebase/frontend/index.html:400 · [source](../../codebase/frontend/index.html#L400) |
| 2,000 nits | 2,000 nits | name only (selected option, when clipped) | codebase/frontend/index.html:401 · [source](../../codebase/frontend/index.html#L401) |
| 4,000 nits | 4,000 nits | name only (selected option, when clipped) | codebase/frontend/index.html:402 · [source](../../codebase/frontend/index.html#L402) |
| Full encoded range | Full encoded range | name only (selected option, when clipped) | codebase/frontend/index.html:403 · [source](../../codebase/frontend/index.html#L403) |
| Custom | Custom | name only (selected option, when clipped) | codebase/frontend/index.html:404 · [source](../../codebase/frontend/index.html#L404) |
| Detecting… | Detecting… | name only (selected option, when clipped) | codebase/frontend/index.html:411 · [source](../../codebase/frontend/index.html#L411) |
| Browser delivery | Renders the encoded artifact through Chromium's adaptive HDR decoder. | fixed | codebase/frontend/index.html:415 · [source](../../codebase/frontend/index.html#L415) |
| Reference target | Reconstructs the encoded gain-map endpoints at the selected headroom for a deterministic comparison with the authored HDR grade. | fixed | codebase/frontend/index.html:416 · [source](../../codebase/frontend/index.html#L416) |
| SDR base | Shows the exact SDR fallback encoded into the proof artifact. | fixed | codebase/frontend/index.html:417 · [source](../../codebase/frontend/index.html#L417) |
| Build proof | Proofs refresh on demand. Grading changes mark the result stale without interrupting editing. | fixed | codebase/frontend/index.html::#chrome-proof-refresh · [source](../../codebase/frontend/index.html#L419) |

### proofing ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| els.viewerBranchNote.textContent | canShow ? &#96;Chromium Proof · ${proofSizeLabel()} · ${proofFormatLabel()} · ${proofPreviewLabel()} · scopes: authored HDR.&#96; : "Chromium Proof is not current · build or refresh it from the Proof settings rail." | dynamic expression | codebase/frontend/proofing-ui.js:330 · [source](../../codebase/frontend/proofing-ui.js#L330) |
| els.viewerBranchNote.textContent | branchCopy[state.currentView] | dynamic expression | codebase/frontend/proofing-ui.js:335 · [source](../../codebase/frontend/proofing-ui.js#L335) |

## Export

### export

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| AVIF + gain map | AVIF + gain map | name only (selected option, when clipped) | codebase/frontend/index.html:1622 · [source](../../codebase/frontend/index.html#L1622) |
| JPEG Ultra HDR | JPEG Ultra HDR | name only (selected option, when clipped) | codebase/frontend/index.html:1623 · [source](../../codebase/frontend/index.html#L1623) |
| JPEG XL HDR | JPEG XL HDR | name only (selected option, when clipped) | codebase/frontend/index.html:1624 · [source](../../codebase/frontend/index.html#L1624) |
| JPEG XL (SDR) | JPEG XL (SDR) | name only (selected option, when clipped) | codebase/frontend/index.html:1625 · [source](../../codebase/frontend/index.html#L1625) |
| PNG (SDR) | PNG (SDR) | name only (selected option, when clipped) | codebase/frontend/index.html:1626 · [source](../../codebase/frontend/index.html#L1626) |
| JPEG (SDR) | JPEG (SDR) | name only (selected option, when clipped) | codebase/frontend/index.html:1627 · [source](../../codebase/frontend/index.html#L1627) |
| Web Default Web Optimized Maximum Fidelity High fidelity JPEG XL Custom | Manual encoding changes switch the preset to Custom. | fixed | codebase/frontend/index.html::#export-preset · [source](../../codebase/frontend/index.html#L1633) |
| Web Default | Web Default | name only (selected option, when clipped) | codebase/frontend/index.html:1634 · [source](../../codebase/frontend/index.html#L1634) |
| Web Optimized | Web Optimized | name only (selected option, when clipped) | codebase/frontend/index.html:1635 · [source](../../codebase/frontend/index.html#L1635) |
| Maximum Fidelity | Maximum Fidelity | name only (selected option, when clipped) | codebase/frontend/index.html:1636 · [source](../../codebase/frontend/index.html#L1636) |
| High fidelity JPEG XL | High fidelity JPEG XL | name only (selected option, when clipped) | codebase/frontend/index.html:1637 · [source](../../codebase/frontend/index.html#L1637) |
| Custom | Custom | name only (selected option, when clipped) | codebase/frontend/index.html:1638 · [source](../../codebase/frontend/index.html#L1638) |
| 8-bit | 8-bit | name only (selected option, when clipped) | codebase/frontend/index.html:1658 · [source](../../codebase/frontend/index.html#L1658) |
| 10-bit | 10-bit | name only (selected option, when clipped) | codebase/frontend/index.html:1658::2 · [source](../../codebase/frontend/index.html#L1658) |
| 12-bit | 12-bit | name only (selected option, when clipped) | codebase/frontend/index.html:1658::3 · [source](../../codebase/frontend/index.html#L1658) |
| 4:2:0 | 4:2:0 | name only (selected option, when clipped) | codebase/frontend/index.html:1661 · [source](../../codebase/frontend/index.html#L1661) |
| 4:2:2 | 4:2:2 | name only (selected option, when clipped) | codebase/frontend/index.html:1661::2 · [source](../../codebase/frontend/index.html#L1661) |
| 4:4:4 | 4:4:4 | name only (selected option, when clipped) | codebase/frontend/index.html:1661::3 · [source](../../codebase/frontend/index.html#L1661) |
| Half | Half | name only (selected option, when clipped) | codebase/frontend/index.html:1668 · [source](../../codebase/frontend/index.html#L1668) |
| Full | Full | name only (selected option, when clipped) | codebase/frontend/index.html:1668::2 · [source](../../codebase/frontend/index.html#L1668) |
| Full | Full | name only (selected option, when clipped) | codebase/frontend/index.html:1677 · [source](../../codebase/frontend/index.html#L1677) |
| Half | Half | name only (selected option, when clipped) | codebase/frontend/index.html:1677::2 · [source](../../codebase/frontend/index.html#L1677) |
| 4:2:0 | 4:2:0 | name only (selected option, when clipped) | codebase/frontend/index.html:1680 · [source](../../codebase/frontend/index.html#L1680) |
| 4:2:2 | 4:2:2 | name only (selected option, when clipped) | codebase/frontend/index.html:1680::2 · [source](../../codebase/frontend/index.html#L1680) |
| 4:4:4 | 4:4:4 | name only (selected option, when clipped) | codebase/frontend/index.html:1680::3 · [source](../../codebase/frontend/index.html#L1680) |
| 4:2:0 | 4:2:0 | name only (selected option, when clipped) | codebase/frontend/index.html:1684 · [source](../../codebase/frontend/index.html#L1684) |
| 4:2:2 | 4:2:2 | name only (selected option, when clipped) | codebase/frontend/index.html:1684::2 · [source](../../codebase/frontend/index.html#L1684) |
| 4:4:4 | 4:4:4 | name only (selected option, when clipped) | codebase/frontend/index.html:1684::3 · [source](../../codebase/frontend/index.html#L1684) |
| 10-bit integer | 10-bit integer | name only (selected option, when clipped) | codebase/frontend/index.html:1687 · [source](../../codebase/frontend/index.html#L1687) |
| 12-bit integer | 12-bit integer | name only (selected option, when clipped) | codebase/frontend/index.html:1687::2 · [source](../../codebase/frontend/index.html#L1687) |
| 16-bit integer | 16-bit integer | name only (selected option, when clipped) | codebase/frontend/index.html:1687::3 · [source](../../codebase/frontend/index.html#L1687) |
| 16-bit float | 16-bit float | name only (selected option, when clipped) | codebase/frontend/index.html:1687::4 · [source](../../codebase/frontend/index.html#L1687) |
| 32-bit float | 32-bit float | name only (selected option, when clipped) | codebase/frontend/index.html:1687::5 · [source](../../codebase/frontend/index.html#L1687) |
| 8-bit | 8-bit | name only (selected option, when clipped) | codebase/frontend/index.html:1691 · [source](../../codebase/frontend/index.html#L1691) |
| 16-bit | 16-bit | name only (selected option, when clipped) | codebase/frontend/index.html:1691::2 · [source](../../codebase/frontend/index.html#L1691) |
| Auto | Auto | name only (selected option, when clipped) | codebase/frontend/index.html:1694 · [source](../../codebase/frontend/index.html#L1694) |
| Off | Off | name only (selected option, when clipped) | codebase/frontend/index.html:1694::2 · [source](../../codebase/frontend/index.html#L1694) |
| Subtle | Subtle | name only (selected option, when clipped) | codebase/frontend/index.html:1694::3 · [source](../../codebase/frontend/index.html#L1694) |
| None | None | name only (selected option, when clipped) | codebase/frontend/index.html:1698 · [source](../../codebase/frontend/index.html#L1698) |
| Copyright only | Copyright only | name only (selected option, when clipped) | codebase/frontend/index.html:1698::2 · [source](../../codebase/frontend/index.html#L1698) |
| All except location | All except location | name only (selected option, when clipped) | codebase/frontend/index.html:1698::3 · [source](../../codebase/frontend/index.html#L1698) |
| All including location | All including location | name only (selected option, when clipped) | codebase/frontend/index.html:1698::4 · [source](../../codebase/frontend/index.html#L1698) |
| Guarantee HDR peakHighlight Compression checks every HDR export and Proof after encoding. Up to 1% above target is accepted unchanged; larger overshoots are corrected locally toward the target. Files still above the allowance are not delivered. This option also checks the codec ceiling when Highlight Compression is bypassed. | Highlight Compression checks every HDR export and Proof after encoding. Up to 1% above target is accepted unchanged; larger overshoots are corrected locally toward the target. Files still above the allowance are not delivered. This option also checks the codec ceiling when Highlight Compression is bypassed. | fixed | codebase/frontend/index.html:1709 · [source](../../codebase/frontend/index.html#L1709) |
| Original (cropped)Long edgeFit within dimensions | Original (cropped) | fixed | codebase/frontend/index.html::#export-resize-mode · [source](../../codebase/frontend/index.html#L1717) |
| Original (cropped) | Original (cropped) | name only (selected option, when clipped) | codebase/frontend/index.html:1717 · [source](../../codebase/frontend/index.html#L1717) |
| Long edge | Long edge | name only (selected option, when clipped) | codebase/frontend/index.html:1717::2 · [source](../../codebase/frontend/index.html#L1717) |
| Fit within dimensions | Fit within dimensions | name only (selected option, when clipped) | codebase/frontend/index.html:1717::3 · [source](../../codebase/frontend/index.html#L1717) |
| Off | Off | name only (selected option, when clipped) | codebase/frontend/index.html:1725 · [source](../../codebase/frontend/index.html#L1725) |
| Subtle | Subtle | name only (selected option, when clipped) | codebase/frontend/index.html:1725::2 · [source](../../codebase/frontend/index.html#L1725) |
| Standard | Standard | name only (selected option, when clipped) | codebase/frontend/index.html:1725::3 · [source](../../codebase/frontend/index.html#L1725) |
| Strong | Strong | name only (selected option, when clipped) | codebase/frontend/index.html:1725::4 · [source](../../codebase/frontend/index.html#L1725) |
| Off | Off | name only (selected option, when clipped) | codebase/frontend/index.html:1731 · [source](../../codebase/frontend/index.html#L1731) |
| Text in both renditions | Text in both renditions | name only (selected option, when clipped) | codebase/frontend/index.html:1731::2 · [source](../../codebase/frontend/index.html#L1731) |
| Gain-map test: HDR / SDR | Gain-map test: HDR / SDR | name only (selected option, when clipped) | codebase/frontend/index.html:1731::3 · [source](../../codebase/frontend/index.html#L1731) |
| Bottom right | Bottom right | name only (selected option, when clipped) | codebase/frontend/index.html:1733 · [source](../../codebase/frontend/index.html#L1733) |
| Bottom left | Bottom left | name only (selected option, when clipped) | codebase/frontend/index.html:1733::2 · [source](../../codebase/frontend/index.html#L1733) |
| Top right | Top right | name only (selected option, when clipped) | codebase/frontend/index.html:1733::3 · [source](../../codebase/frontend/index.html#L1733) |
| Top left | Top left | name only (selected option, when clipped) | codebase/frontend/index.html:1733::4 · [source](../../codebase/frontend/index.html#L1733) |

### batch export

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| element.dataset.tooltip | text | dynamic expression | codebase/frontend/batch-export.js:7 · [source](../../codebase/frontend/batch-export.js#L7) |
| b aria-label | label | dynamic expression; name/status supplied at runtime | codebase/frontend/batch-export.js:58 · [source](../../codebase/frontend/batch-export.js#L58) |
| label — text used by dynamic tooltips | failed?"Failed":active?(model.job.stage&#124;&#124;"Exporting…"):skipped?&#96;${skipped} skipped&#96;:results.length?"Done":"" | dynamic supporting definition | codebase/frontend/batch-export.js:155 · [source](../../codebase/frontend/batch-export.js#L155) |
| model — text used by dynamic tooltips | {paths:[],photos:[],presets:[],draft:null,saved:null,version:0,job:null,selected:new Set(),directory:"",grant:null,anchor:0,closedJob:null} | dynamic supporting definition | codebase/frontend/batch-export.js:3 · [source](../../codebase/frontend/batch-export.js#L3) |
| job — text used by dynamic tooltips | await api("/api/batch-export",{paths,preset,directory:model.directory,path_grant:model.grant},"POST",{id:crypto.randomUUID()}) | dynamic supporting definition | codebase/frontend/batch-export.js:238 · [source](../../codebase/frontend/batch-export.js#L238) |
| skipped — text used by dynamic tooltips | results.filter(r=&gt;r.outcome==="skipped").length | dynamic supporting definition | codebase/frontend/batch-export.js:154 · [source](../../codebase/frontend/batch-export.js#L154) |
| results — text used by dynamic tooltips | node("ul") | dynamic supporting definition | codebase/frontend/batch-export.js:329 · [source](../../codebase/frontend/batch-export.js#L329) |
| b.title | label | dynamic expression; name/status supplied at runtime | codebase/frontend/batch-export.js:58::2 · [source](../../codebase/frontend/batch-export.js#L58) |
| els.exportResizeMode.title | els.exportResizeMode.selectedOptions[0]?.textContent &#124;&#124; "" | dynamic expression | codebase/frontend/batch-export.js:107 · [source](../../codebase/frontend/batch-export.js#L107) |
| patternHelp.dataset.tooltip | $("batch-example").textContent | dynamic expression | codebase/frontend/batch-export.js:108 · [source](../../codebase/frontend/batch-export.js#L108) |
| meter aria-label | &#96;Export progress for ${p.name}&#96; | dynamic expression | codebase/frontend/batch-export.js:157 · [source](../../codebase/frontend/batch-export.js#L157) |
| name — text used by dynamic tooltips | node("input") | dynamic supporting definition | codebase/frontend/batch-export.js:264 · [source](../../codebase/frontend/batch-export.js#L264) |
| firstChild aria-label | error.message | dynamic expression | codebase/frontend/batch-export.js:207 · [source](../../codebase/frontend/batch-export.js#L207) |
| .title | model.directory | dynamic expression | codebase/frontend/batch-export.js:227 · [source](../../codebase/frontend/batch-export.js#L227) |
| .title | model.directory | dynamic expression | codebase/frontend/batch-export.js:234 · [source](../../codebase/frontend/batch-export.js#L234) |
| .title | model.directory | dynamic expression | codebase/frontend/batch-export.js:237 · [source](../../codebase/frontend/batch-export.js#L237) |
| collapse aria-label | collapsed?"Expand export presets":"Collapse export presets" | dynamic expression | codebase/frontend/batch-export.js:257 · [source](../../codebase/frontend/batch-export.js#L257) |
| collapsed — text used by dynamic tooltips | document.body.classList.toggle("batch-presets-collapsed") | dynamic supporting definition | codebase/frontend/batch-export.js:255 · [source](../../codebase/frontend/batch-export.js#L255) |
| collapse.title | collapsed?"Expand export presets":"Collapse export presets" | dynamic expression | codebase/frontend/batch-export.js:258 · [source](../../codebase/frontend/batch-export.js#L258) |
| collapse aria-label | Collapse export presets | name only (fallback candidate) | codebase/frontend/batch-export.js:262 · [source](../../codebase/frontend/batch-export.js#L262) |
| collapse.title | Collapse export presets | fixed | codebase/frontend/batch-export.js:262::2 · [source](../../codebase/frontend/batch-export.js#L262) |
| select aria-label | Output version | name only (fallback candidate) | codebase/frontend/batch-export.js:271 · [source](../../codebase/frontend/batch-export.js#L271) |
| exportFormat aria-label | Format | name only (fallback candidate) | codebase/frontend/batch-export.js:277 · [source](../../codebase/frontend/batch-export.js#L277) |
| exportPreset aria-label | Quality profile | name only (fallback candidate) | codebase/frontend/batch-export.js:277::2 · [source](../../codebase/frontend/batch-export.js#L277) |
| els.exportResizeMode.title | els.exportResizeMode.selectedOptions[0]?.textContent &#124;&#124; "" | dynamic expression | codebase/frontend/batch-export.js:279 · [source](../../codebase/frontend/batch-export.js#L279) |
| input aria-label | &#96;${label} in pixels&#96; | dynamic expression | codebase/frontend/batch-export.js:284 · [source](../../codebase/frontend/batch-export.js#L284) |
| pattern aria-label | File name pattern | name only (fallback candidate) | codebase/frontend/batch-export.js:300 · [source](../../codebase/frontend/batch-export.js#L300) |
| tokens aria-label | Insert filename token | name only (fallback candidate) | codebase/frontend/batch-export.js:301 · [source](../../codebase/frontend/batch-export.js#L301) |
| dest aria-label | Destination folder | name only (fallback candidate) | codebase/frontend/batch-export.js:313 · [source](../../codebase/frontend/batch-export.js#L313) |
| dest.title | dest.value | dynamic expression; name/status supplied at runtime | codebase/frontend/batch-export.js:313::2 · [source](../../codebase/frontend/batch-export.js#L313) |
| dest — text used by dynamic tooltips | node("input") | dynamic supporting definition | codebase/frontend/batch-export.js:313::3 · [source](../../codebase/frontend/batch-export.js#L313) |
| b aria-label | kind==="grid"?"Grid":"Preview" | dynamic expression | codebase/frontend/batch-export.js:320 · [source](../../codebase/frontend/batch-export.js#L320) |
| b.title | kind==="grid"?"Grid":"Preview" | dynamic expression | codebase/frontend/batch-export.js:320::2 · [source](../../codebase/frontend/batch-export.js#L320) |
| b.title | label | dynamic expression; name/status supplied at runtime | codebase/frontend/batch-export.js:321 · [source](../../codebase/frontend/batch-export.js#L321) |
| b aria-label | label | dynamic expression; name/status supplied at runtime | codebase/frontend/batch-export.js:321::2 · [source](../../codebase/frontend/batch-export.js#L321) |
| grid aria-label | Photos in this batch | name only (fallback candidate) | codebase/frontend/batch-export.js:323 · [source](../../codebase/frontend/batch-export.js#L323) |
| meter aria-label | Overall export progress | name only (fallback candidate) | codebase/frontend/batch-export.js:329::2 · [source](../../codebase/frontend/batch-export.js#L329) |
| Export help | Each output version creates a separate file from the same saved photo edits, with its own export settings (format, size and naming). Changes here affect only the selected version. Export creates all versions. | fixed | codebase/frontend/batch-export.js:273 · [source](../../codebase/frontend/batch-export.js#L273) |
| Export help | framingNote.textContent | dynamic expression | codebase/frontend/batch-export.js:290 · [source](../../codebase/frontend/batch-export.js#L290) |
| Export help | Filename preview | fixed | codebase/frontend/batch-export.js:304 · [source](../../codebase/frontend/batch-export.js#L304) |

### export ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| exportOptionTooltips / avifBitDepth / 8 | Smallest AVIF primary image; lower gradient precision. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:56 · [source](../../codebase/frontend/export-ui.js#L56) |
| exportOptionTooltips / avifBitDepth / 10 | Balanced AVIF precision for HDR publishing. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:57 · [source](../../codebase/frontend/export-ui.js#L57) |
| exportOptionTooltips / avifBitDepth / 12 | Highest available AVIF primary-image precision. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:58 · [source](../../codebase/frontend/export-ui.js#L58) |
| exportOptionTooltips / avifChromaSubsampling / 420 | Smallest primary image; suitable for most photographic content. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:61 · [source](../../codebase/frontend/export-ui.js#L61) |
| exportOptionTooltips / avifChromaSubsampling / 422 | Retains more horizontal color detail. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:62 · [source](../../codebase/frontend/export-ui.js#L62) |
| exportOptionTooltips / avifChromaSubsampling / 444 | Retains full color resolution for fine colored edges and text. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:63 · [source](../../codebase/frontend/export-ui.js#L63) |
| exportOptionTooltips / avifGainMapScale / full | Stores the gain map at full image resolution. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:66 · [source](../../codebase/frontend/export-ui.js#L66) |
| exportOptionTooltips / avifGainMapScale / half | Stores a half-resolution gain map to reduce delivery size. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:67 · [source](../../codebase/frontend/export-ui.js#L67) |
| exportOptionTooltips / jpegGainMapScale / full | Stores the gain map at full image resolution. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:70 · [source](../../codebase/frontend/export-ui.js#L70) |
| exportOptionTooltips / jpegGainMapScale / half | Stores a half-resolution gain map to reduce delivery size. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:71 · [source](../../codebase/frontend/export-ui.js#L71) |
| exportOptionTooltips / jpegUltrahdrChromaSubsampling / 420 | Smallest primary JPEG; suitable for most photographic content. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:74 · [source](../../codebase/frontend/export-ui.js#L74) |
| exportOptionTooltips / jpegUltrahdrChromaSubsampling / 422 | Retains more horizontal color detail. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:75 · [source](../../codebase/frontend/export-ui.js#L75) |
| exportOptionTooltips / jpegUltrahdrChromaSubsampling / 444 | Retains full color resolution for fine colored edges and text. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:76 · [source](../../codebase/frontend/export-ui.js#L76) |
| exportOptionTooltips / jpegChromaSubsampling / 420 | Smallest JPEG; suitable for most photographic content. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:79 · [source](../../codebase/frontend/export-ui.js#L79) |
| exportOptionTooltips / jpegChromaSubsampling / 422 | Retains more horizontal color detail. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:80 · [source](../../codebase/frontend/export-ui.js#L80) |
| exportOptionTooltips / jpegChromaSubsampling / 444 | Retains full color resolution for fine colored edges and text. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:81 · [source](../../codebase/frontend/export-ui.js#L81) |
| exportOptionTooltips / jpegxlPrecision / uint10 | Compact integer HDR precision. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:84 · [source](../../codebase/frontend/export-ui.js#L84) |
| exportOptionTooltips / jpegxlPrecision / uint12 | Balanced integer HDR precision. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:85 · [source](../../codebase/frontend/export-ui.js#L85) |
| exportOptionTooltips / jpegxlPrecision / uint16 | Highest practical integer precision. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:86 · [source](../../codebase/frontend/export-ui.js#L86) |
| exportOptionTooltips / jpegxlPrecision / float16 | Specialist half-float interchange. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:87 · [source](../../codebase/frontend/export-ui.js#L87) |
| exportOptionTooltips / jpegxlPrecision / float32 | Specialist full-float interchange with the largest files. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:88 · [source](../../codebase/frontend/export-ui.js#L88) |
| exportOptionTooltips / sdrPngBitDepth / 8 | Standard web-compatible PNG precision. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:91 · [source](../../codebase/frontend/export-ui.js#L91) |
| exportOptionTooltips / sdrPngBitDepth / 16 | High-precision PNG interchange. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:92 · [source](../../codebase/frontend/export-ui.js#L92) |
| exportOptionTooltips / exportDithering / auto | Applies deterministic signal-domain dither when exporting 8-bit output. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:95 · [source](../../codebase/frontend/export-ui.js#L95) |
| exportOptionTooltips / exportDithering / off | Disables export dithering. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:96 · [source](../../codebase/frontend/export-ui.js#L96) |
| exportOptionTooltips / exportDithering / subtle | Applies subtle signal-domain dither. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:97 · [source](../../codebase/frontend/export-ui.js#L97) |
| exportOptionTooltips / exportMetadataPolicy / none | Removes optional source metadata while retaining required color and HDR signaling. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:100 · [source](../../codebase/frontend/export-ui.js#L100) |
| exportOptionTooltips / exportMetadataPolicy / copyright | Preserves copyright metadata only. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:101 · [source](../../codebase/frontend/export-ui.js#L101) |
| exportOptionTooltips / exportMetadataPolicy / all_except_location | Preserves source metadata except location information. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:102 · [source](../../codebase/frontend/export-ui.js#L102) |
| exportOptionTooltips / exportMetadataPolicy / all_including_location | Preserves all supported source metadata, including possible GPS coordinates. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:103 · [source](../../codebase/frontend/export-ui.js#L103) |
| exportOptionTooltips / exportResizeMode / original | Keeps cropped photo pixels; adds the Frame and Border when included. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:106 · [source](../../codebase/frontend/export-ui.js#L106) |
| exportOptionTooltips / exportResizeMode / long_edge | Resizes the complete canvas, including any Frame and Border, by its longest edge. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:107 · [source](../../codebase/frontend/export-ui.js#L107) |
| exportOptionTooltips / exportResizeMode / fit | Fits the complete canvas, including any Frame and Border, within the width and height limits. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:108 · [source](../../codebase/frontend/export-ui.js#L108) |
| exportOptionTooltips / exportSharpening / off | No output sharpening. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:111 · [source](../../codebase/frontend/export-ui.js#L111) |
| exportOptionTooltips / exportSharpening / subtle | Light edge-aware sharpening after resize. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:112 · [source](../../codebase/frontend/export-ui.js#L112) |
| exportOptionTooltips / exportSharpening / standard | Moderate edge-aware sharpening after resize. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:113 · [source](../../codebase/frontend/export-ui.js#L113) |
| exportOptionTooltips / exportSharpening / strong | Strong edge-aware sharpening after resize. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:114 · [source](../../codebase/frontend/export-ui.js#L114) |
| exportFormatNotes / avif_gain_map | Efficient adaptive HDR for current Chromium browsers, with an SDR base for other decoders. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:46 · [source](../../codebase/frontend/export-ui.js#L46) |
| exportFormatNotes / jpeg_ultrahdr | Broad JPEG fallback with HDR in compatible viewers; recompression can remove the gain map. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:47 · [source](../../codebase/frontend/export-ui.js#L47) |
| exportFormatNotes / jpegxl_hdr | Direct Rec.2020 PQ HDR for specialist workflows; no SDR fallback and limited browser support. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:48 · [source](../../codebase/frontend/export-ui.js#L48) |
| exportFormatNotes / sdr_jpegxl | Compact SDR for JPEG XL-aware workflows; browser support remains uneven. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:49 · [source](../../codebase/frontend/export-ui.js#L49) |
| exportFormatNotes / sdr_png | Lossless SDR delivery with 8-bit web and 16-bit fidelity choices. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:50 · [source](../../codebase/frontend/export-ui.js#L50) |
| exportFormatNotes / sdr_jpeg | Conventional compact SDR JPEG, including very wide images up to 65,500 pixels. | fixed (dynamic lookup) | codebase/frontend/export-ui.js:51 · [source](../../codebase/frontend/export-ui.js#L51) |

## Dialogs and settings

### directory-browser / directory-browser-close

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Close | Close folder browser | name only (fallback) | codebase/frontend/index.html::#directory-browser-close · [source](../../codebase/frontend/index.html#L1766) |
| Close | Close folder browser | name only (fallback) | codebase/frontend/media-browser-standalone.html::#directory-browser-close · [source](../../codebase/frontend/media-browser-standalone.html#L15) |

### directory-browser

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Resize Name column | Resize Name column | name only (fallback) | codebase/frontend/index.html:1784 · [source](../../codebase/frontend/index.html#L1784) |
| Resize Size column | Resize Size column | name only (fallback) | codebase/frontend/index.html:1788 · [source](../../codebase/frontend/index.html#L1788) |
| Resize Kind column | Resize Kind column | name only (fallback) | codebase/frontend/index.html:1792 · [source](../../codebase/frontend/index.html#L1792) |
| Resize Date Added column | Resize Date Added column | name only (fallback) | codebase/frontend/index.html:1796 · [source](../../codebase/frontend/index.html#L1796) |
| Resize preview panel | Resize preview panel | name only (fallback) | codebase/frontend/index.html:1801 · [source](../../codebase/frontend/index.html#L1801) |
| Resize Name column | Resize Name column | name only (fallback) | codebase/frontend/media-browser-standalone.html:33 · [source](../../codebase/frontend/media-browser-standalone.html#L33) |
| Resize Size column | Resize Size column | name only (fallback) | codebase/frontend/media-browser-standalone.html:37 · [source](../../codebase/frontend/media-browser-standalone.html#L37) |
| Resize Kind column | Resize Kind column | name only (fallback) | codebase/frontend/media-browser-standalone.html:41 · [source](../../codebase/frontend/media-browser-standalone.html#L41) |
| Resize Date Added column | Resize Date Added column | name only (fallback) | codebase/frontend/media-browser-standalone.html:45 · [source](../../codebase/frontend/media-browser-standalone.html#L45) |
| Resize preview panel | Resize preview panel | name only (fallback) | codebase/frontend/media-browser-standalone.html:50 · [source](../../codebase/frontend/media-browser-standalone.html#L50) |

### settings-dialog

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Close settings | Close | fixed | codebase/frontend/index.html::#settings-close · [source](../../codebase/frontend/index.html#L1822) |

### general

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| 203 nit · Standard | 203 nit · Standard | name only (selected option, when clipped) | codebase/frontend/index.html:1840 · [source](../../codebase/frontend/index.html#L1840) |
| 100 nit · Controlled workflow | 100 nit · Controlled workflow | name only (selected option, when clipped) | codebase/frontend/index.html:1841 · [source](../../codebase/frontend/index.html#L1841) |

### performance

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| 1 GB | 1 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1855 · [source](../../codebase/frontend/index.html#L1855) |
| 2 GB | 2 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1855::2 · [source](../../codebase/frontend/index.html#L1855) |
| 5 GB | 5 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1855::3 · [source](../../codebase/frontend/index.html#L1855) |
| 10 GB | 10 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1855::4 · [source](../../codebase/frontend/index.html#L1855) |
| 20 GB | 20 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1855::5 · [source](../../codebase/frontend/index.html#L1855) |
| 1 GB | 1 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1859 · [source](../../codebase/frontend/index.html#L1859) |
| 2 GB | 2 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1859::2 · [source](../../codebase/frontend/index.html#L1859) |
| 5 GB | 5 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1859::3 · [source](../../codebase/frontend/index.html#L1859) |
| 10 GB | 10 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1859::4 · [source](../../codebase/frontend/index.html#L1859) |
| 20 GB | 20 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1859::5 · [source](../../codebase/frontend/index.html#L1859) |
| 1 GB | 1 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1863 · [source](../../codebase/frontend/index.html#L1863) |
| 2 GB | 2 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1863::2 · [source](../../codebase/frontend/index.html#L1863) |
| 5 GB | 5 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1863::3 · [source](../../codebase/frontend/index.html#L1863) |
| 10 GB | 10 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1863::4 · [source](../../codebase/frontend/index.html#L1863) |
| 20 GB | 20 GB | name only (selected option, when clipped) | codebase/frontend/index.html:1863::5 · [source](../../codebase/frontend/index.html#L1863) |
| Auto · Recommended | Auto · Recommended | name only (selected option, when clipped) | codebase/frontend/index.html:1875 · [source](../../codebase/frontend/index.html#L1875) |
| GPU preferred | GPU preferred | name only (selected option, when clipped) | codebase/frontend/index.html:1876 · [source](../../codebase/frontend/index.html#L1876) |
| CPU compatibility | CPU compatibility | name only (selected option, when clipped) | codebase/frontend/index.html:1877 · [source](../../codebase/frontend/index.html#L1877) |
| Faster dragging | For slower computers: shows a softer image while you drag, sharp again when you let go. Exports are unaffected. | fixed | codebase/frontend/index.html:1881 · [source](../../codebase/frontend/index.html#L1881) |
| Auto · up to half of your graphics card's memory | Auto · up to half of your graphics card's memory | name only (selected option, when clipped) | codebase/frontend/index.html:1890 · [source](../../codebase/frontend/index.html#L1890) |
| 1 GiB | 1 GiB | name only (selected option, when clipped) | codebase/frontend/index.html:1891 · [source](../../codebase/frontend/index.html#L1891) |
| 2 GiB | 2 GiB | name only (selected option, when clipped) | codebase/frontend/index.html:1892 · [source](../../codebase/frontend/index.html#L1892) |
| 3 GiB | 3 GiB | name only (selected option, when clipped) | codebase/frontend/index.html:1893 · [source](../../codebase/frontend/index.html#L1893) |
| 4 GiB | 4 GiB | name only (selected option, when clipped) | codebase/frontend/index.html:1894 · [source](../../codebase/frontend/index.html#L1894) |
| 6 GiB | 6 GiB | name only (selected option, when clipped) | codebase/frontend/index.html:1895 · [source](../../codebase/frontend/index.html#L1895) |
| 8 GiB | 8 GiB | name only (selected option, when clipped) | codebase/frontend/index.html:1896 · [source](../../codebase/frontend/index.html#L1896) |
| 12 GiB | 12 GiB | name only (selected option, when clipped) | codebase/frontend/index.html:1897 · [source](../../codebase/frontend/index.html#L1897) |
| Custom… | Custom… | name only (selected option, when clipped) | codebase/frontend/index.html:1898 · [source](../../codebase/frontend/index.html#L1898) |

### appearance

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| On hover | On hover | name only (selected option, when clipped) | codebase/frontend/index.html:1913 · [source](../../codebase/frontend/index.html#L1913) |
| Always | Always | name only (selected option, when clipped) | codebase/frontend/index.html:1913::2 · [source](../../codebase/frontend/index.html#L1913) |

### shortcuts

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Shortcut presets… | Shortcut presets… | name only (selected option, when clipped) | codebase/frontend/index.html:1938 · [source](../../codebase/frontend/index.html#L1938) |

### diagnostics

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Auto · the budget decides Force Direct Force Tiled | Diagnostic. Auto lets the memory budget decide. Forcing Tiled always works. Forcing Direct is ignored when the budget cannot hold a whole-frame render, because a diagnostic switch must not override the memory guard. | fixed | codebase/frontend/index.html::#settings-execution-override · [source](../../codebase/frontend/index.html#L1949) |
| Auto · the budget decides | Auto · the budget decides | name only (selected option, when clipped) | codebase/frontend/index.html:1950 · [source](../../codebase/frontend/index.html#L1950) |
| Force Direct | Force Direct | name only (selected option, when clipped) | codebase/frontend/index.html:1951 · [source](../../codebase/frontend/index.html#L1951) |
| Force Tiled | Force Tiled | name only (selected option, when clipped) | codebase/frontend/index.html:1952 · [source](../../codebase/frontend/index.html#L1952) |
| Off · display driven | Off · display driven | name only (selected option, when clipped) | codebase/frontend/index.html:1958 · [source](../../codebase/frontend/index.html#L1958) |
| 1K | 1K | name only (selected option, when clipped) | codebase/frontend/index.html:1959 · [source](../../codebase/frontend/index.html#L1959) |
| 2K | 2K | name only (selected option, when clipped) | codebase/frontend/index.html:1960 · [source](../../codebase/frontend/index.html#L1960) |
| 4K | 4K | name only (selected option, when clipped) | codebase/frontend/index.html:1961 · [source](../../codebase/frontend/index.html#L1961) |
| Full | Full | name only (selected option, when clipped) | codebase/frontend/index.html:1962 · [source](../../codebase/frontend/index.html#L1962) |
| Whole frame · refinement processes every tile Visible region · refinement processes what you see | When enabled, only the refinement pass is limited to the visible region: the tiles you can see are refined at full tier quality and the rest of the frame keeps the accepted image. Pan and zoom are never limited, so a newly exposed region always has complete pixels. | fixed | codebase/frontend/index.html::#settings-roi-preview · [source](../../codebase/frontend/index.html#L1967) |
| Whole frame · refinement processes every tile | Whole frame · refinement processes every tile | name only (selected option, when clipped) | codebase/frontend/index.html:1968 · [source](../../codebase/frontend/index.html#L1968) |
| Visible region · refinement processes what you see | Visible region · refinement processes what you see | name only (selected option, when clipped) | codebase/frontend/index.html:1969 · [source](../../codebase/frontend/index.html#L1969) |

### library dialogs

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| dialog aria-label | title | dynamic expression; name/status supplied at runtime | codebase/frontend/library-dialogs.js:9 · [source](../../codebase/frontend/library-dialogs.js#L9) |
| menu aria-label | label | dynamic expression; name/status supplied at runtime | codebase/frontend/library-dialogs.js:46 · [source](../../codebase/frontend/library-dialogs.js#L46) |
| label — text used by dynamic tooltips | make("label", "library-ask-field") | dynamic supporting definition | codebase/frontend/library-dialogs.js:14 · [source](../../codebase/frontend/library-dialogs.js#L14) |

### library folder picker

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| button.title | place.path | dynamic expression; name/status supplied at runtime | codebase/frontend/library-folder-picker.js:29 · [source](../../codebase/frontend/library-folder-picker.js#L29) |
| item.frame.title | Making a temporary thumbnail… | fixed | codebase/frontend/library-folder-picker.js:200 · [source](../../codebase/frontend/library-folder-picker.js#L200) |
| item.frame.title | error.message | dynamic expression | codebase/frontend/library-folder-picker.js:205 · [source](../../codebase/frontend/library-folder-picker.js#L205) |
| button.title | entry.path | dynamic expression; name/status supplied at runtime | codebase/frontend/library-folder-picker.js:210 · [source](../../codebase/frontend/library-folder-picker.js#L210) |

### media browser

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| directoryBrowserList aria-label | projectMode ? "Folders and HDR Finisher projects" : "Folders and supported images" | dynamic expression | codebase/frontend/media-browser.js:86 · [source](../../codebase/frontend/media-browser.js#L86) |
| projectMode — text used by dynamic tooltips | mode === "project_open" &#124;&#124; mode === "project_save" | dynamic supporting definition | codebase/frontend/media-browser.js:69 · [source](../../codebase/frontend/media-browser.js#L69) |
| mode — text used by dynamic tooltips | els.directoryBrowser.dataset.mode &#124;&#124; "source" | dynamic supporting definition | codebase/frontend/media-browser.js:677 · [source](../../codebase/frontend/media-browser.js#L677) |
| cell.title | value | dynamic expression | codebase/frontend/media-browser.js:160 · [source](../../codebase/frontend/media-browser.js#L160) |
| button aria-label | active ? &#96;Sort by ${button.textContent}, currently ${direction}&#96; : &#96;Sort by ${button.textContent}&#96; | dynamic expression | codebase/frontend/media-browser.js:197 · [source](../../codebase/frontend/media-browser.js#L197) |
| direction — text used by dynamic tooltips | active ? state.mediaBrowserSortDirection : "none" | dynamic supporting definition | codebase/frontend/media-browser.js:193 · [source](../../codebase/frontend/media-browser.js#L193) |
| state — text used by dynamic tooltips | { mediaBrowserGeneration: 0, mediaBrowserDirectoryReady: false, mediaPreviewGeneration: 0, mediaPreviewRequest: null, mediaPreviewObjectUrl: null, mediaBrowserEntries: [], mediaBrowserSortKey: "name", mediaBrowserSortDirection: "ascending", mediaBrowserColumnWidths: null, mediaBrowserColumnResize: null, mediaBrowserPreviewWidth: null, mediaBrowserPreviewResize: null, mediaBrowserResolver: null, } | dynamic supporting definition | codebase/frontend/media-browser.js:12 · [source](../../codebase/frontend/media-browser.js#L12) |
| button.title | entry.path | dynamic expression; name/status supplied at runtime | codebase/frontend/media-browser.js:361 · [source](../../codebase/frontend/media-browser.js#L361) |
| button aria-label | &#96;${entry.name}, file&#96; | dynamic expression | codebase/frontend/media-browser.js:412 · [source](../../codebase/frontend/media-browser.js#L412) |
| button.title | entry.available ? entry.path : "This saved location is currently unavailable" | dynamic expression | codebase/frontend/media-browser.js:484 · [source](../../codebase/frontend/media-browser.js#L484) |
| remove aria-label | &#96;Remove ${entry.name} from locations&#96; | dynamic expression | codebase/frontend/media-browser.js:489 · [source](../../codebase/frontend/media-browser.js#L489) |
| directoryBrowserPreviewFrame aria-label | Preview withheld because color interpretation is required | name only (fallback candidate) | codebase/frontend/media-browser.js:609 · [source](../../codebase/frontend/media-browser.js#L609) |

## Menus and window controls

### application shell

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| choose.title | choose.disabled ? "Folder preferences use native dialogs in the desktop app." : "" | dynamic expression | codebase/frontend/application-shell.js:562 · [source](../../codebase/frontend/application-shell.js#L562) |
| record aria-label | &#96;Change shortcut for ${command.label}&#96; | dynamic expression | codebase/frontend/application-shell.js:616 · [source](../../codebase/frontend/application-shell.js#L616) |

### desktop chrome

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| menuButton aria-label | Application menus | name only (fallback candidate) | codebase/frontend/desktop-chrome.js:36 · [source](../../codebase/frontend/desktop-chrome.js#L36) |
| maximize aria-label | maximized ? "Restore" : "Maximize" | dynamic expression | codebase/frontend/desktop-chrome.js:195 · [source](../../codebase/frontend/desktop-chrome.js#L195) |
| maximize.title | maximized ? "Restore" : "Maximize" | dynamic expression | codebase/frontend/desktop-chrome.js:196 · [source](../../codebase/frontend/desktop-chrome.js#L196) |

## Viewer, scopes and shared controls

### index

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Minimize | Minimize | fixed; name only | codebase/frontend/index.html:98 · [source](../../codebase/frontend/index.html#L98) |
| Maximize | Maximize | fixed; name only | codebase/frontend/index.html:99 · [source](../../codebase/frontend/index.html#L99) |
| Close | Close | fixed; name only | codebase/frontend/index.html:100 · [source](../../codebase/frontend/index.html#L100) |
| Autosave on | Autosave grades to the file beside each photo | fixed | codebase/frontend/index.html::#grade-autosave · [source](../../codebase/frontend/index.html#L117) |
| Settings | Settings | fixed; name only | codebase/frontend/index.html::#settings-open · [source](../../codebase/frontend/index.html#L121) |
| Help | Help | fixed; name only | codebase/frontend/index.html::#help-open · [source](../../codebase/frontend/index.html#L122) |
| Dismiss | Dismiss update notice | name only (fallback) | codebase/frontend/index.html::#update-notice-dismiss · [source](../../codebase/frontend/index.html#L130) |
| library-frame | Photo Library | fixed | codebase/frontend/index.html::#library-frame · [source](../../codebase/frontend/index.html#L134) |
| Collapse source metadata | Collapse metadata | fixed | codebase/frontend/index.html::#source-rail-expand · [source](../../codebase/frontend/index.html#L140) |
| No active image | No active image | fixed | codebase/frontend/index.html::#session-name-tooltip · [source](../../codebase/frontend/index.html#L147) |
| Auto Detect | Auto Detect | name only (selected option, when clipped) | codebase/frontend/index.html:171 · [source](../../codebase/frontend/index.html#L171) |
| Manual Override | Manual Override | name only (selected option, when clipped) | codebase/frontend/index.html:172 · [source](../../codebase/frontend/index.html#L172) |
| Auto | Auto | name only (selected option, when clipped) | codebase/frontend/index.html:177 · [source](../../codebase/frontend/index.html#L177) |
| Scene-Linear sRGB / Rec.709 | Scene-Linear sRGB / Rec.709 | name only (selected option, when clipped) | codebase/frontend/index.html:178 · [source](../../codebase/frontend/index.html#L178) |
| Scene-Linear Rec.2020 | Scene-Linear Rec.2020 | name only (selected option, when clipped) | codebase/frontend/index.html:179 · [source](../../codebase/frontend/index.html#L179) |
| ACEScg Linear | ACEScg Linear | name only (selected option, when clipped) | codebase/frontend/index.html:180 · [source](../../codebase/frontend/index.html#L180) |
| Display P3 Linear | Display P3 Linear | name only (selected option, when clipped) | codebase/frontend/index.html:181 · [source](../../codebase/frontend/index.html#L181) |
| Auto | Auto | name only (selected option, when clipped) | codebase/frontend/index.html:186 · [source](../../codebase/frontend/index.html#L186) |
| Linear | Linear | name only (selected option, when clipped) | codebase/frontend/index.html:187 · [source](../../codebase/frontend/index.html#L187) |
| PQ | PQ | name only (selected option, when clipped) | codebase/frontend/index.html:188 · [source](../../codebase/frontend/index.html#L188) |
| HLG | HLG | name only (selected option, when clipped) | codebase/frontend/index.html:189 · [source](../../codebase/frontend/index.html#L189) |
| sRGB | sRGB | name only (selected option, when clipped) | codebase/frontend/index.html:190 · [source](../../codebase/frontend/index.html#L190) |
| 0.18 = diffuse white (scene-linear) | 0.18 = diffuse white (scene-linear) | name only (selected option, when clipped) | codebase/frontend/index.html:195 · [source](../../codebase/frontend/index.html#L195) |
| 1.0 = diffuse white (Affinity) | 1.0 = diffuse white (Affinity) | name only (selected option, when clipped) | codebase/frontend/index.html:196 · [source](../../codebase/frontend/index.html#L196) |
| Resize source rail | Resize source rail | name only (fallback) | codebase/frontend/index.html::#source-splitter · [source](../../codebase/frontend/index.html#L219) |
| Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side. | Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side. | fixed | codebase/frontend/index.html::#viewer-branch-note · [source](../../codebase/frontend/index.html#L237) |
| Single frame | Single frame · tap V to switch, hold V to peek | fixed | codebase/frontend/index.html::#compare-button · [source](../../codebase/frontend/index.html#L242) |
| Vertical split | Vertical split · HDR left, SDR right | fixed | codebase/frontend/index.html:245 · [source](../../codebase/frontend/index.html#L245) |
| Horizontal split | Horizontal split · HDR top, SDR bottom | fixed | codebase/frontend/index.html:248 · [source](../../codebase/frontend/index.html#L248) |
| Side-by-side horizontal | Side by side · HDR left, SDR right | fixed | codebase/frontend/index.html:251 · [source](../../codebase/frontend/index.html#L251) |
| Side-by-side vertical | Stacked · HDR top, SDR bottom | fixed | codebase/frontend/index.html:254 · [source](../../codebase/frontend/index.html#L254) |
| Toggle Scope Region (Shift+R) | Scope Region · draw a box to limit scopes · Shift+R | fixed | codebase/frontend/index.html::#scope-region-toggle · [source](../../codebase/frontend/index.html#L259) |
| &minus; | Zoom out | fixed | codebase/frontend/index.html::#zoom-out · [source](../../codebase/frontend/index.html#L271) |
| Zoom percentage | Enter a zoom percentage | fixed | codebase/frontend/index.html::#zoom-readout · [source](../../codebase/frontend/index.html#L272) |
| Zoom in | Zoom in | fixed; name only | codebase/frontend/index.html::#zoom-in · [source](../../codebase/frontend/index.html#L274) |
| Fit | Fit image in viewer (F) | fixed | codebase/frontend/index.html::#zoom-fit · [source](../../codebase/frontend/index.html#L278) |
| 100% | Show one image pixel per screen pixel (A) | fixed | codebase/frontend/index.html::#zoom-actual · [source](../../codebase/frontend/index.html#L279) |
| Overlays | Overlays | fixed; name only | codebase/frontend/index.html::#overlay-toggle · [source](../../codebase/frontend/index.html#L282) |
| Frame | Frame | fixed; name only | codebase/frontend/index.html::#photo-frame-toggle · [source](../../codebase/frontend/index.html#L284) |
| Background | Background: Set the neutral surround behind the image, kept separate from the application theme. | fixed | codebase/frontend/index.html::#frame-toggle · [source](../../codebase/frontend/index.html#L285) |
| Off | Off | name only (selected option, when clipped) | codebase/frontend/index.html:294 · [source](../../codebase/frontend/index.html#L294) |
| False Color | False Color | name only (selected option, when clipped) | codebase/frontend/index.html:295 · [source](../../codebase/frontend/index.html#L295) |
| Zebra | Zebra | name only (selected option, when clipped) | codebase/frontend/index.html:296 · [source](../../codebase/frontend/index.html#L296) |
| Project HDR reference white | Project HDR reference white | name only (selected option, when clipped) | codebase/frontend/index.html:301 · [source](../../codebase/frontend/index.html#L301) |
| Fixed 100 nit | Fixed 100 nit | name only (selected option, when clipped) | codebase/frontend/index.html:302 · [source](../../codebase/frontend/index.html#L302) |
| Fixed 203 nit | Fixed 203 nit | name only (selected option, when clipped) | codebase/frontend/index.html:303 · [source](../../codebase/frontend/index.html#L303) |
| 100 nit | 100 nit | name only (selected option, when clipped) | codebase/frontend/index.html:308 · [source](../../codebase/frontend/index.html#L308) |
| 1,000 nit | 1,000 nit | name only (selected option, when clipped) | codebase/frontend/index.html:309 · [source](../../codebase/frontend/index.html#L309) |
| 4,000 nit | 4,000 nit | name only (selected option, when clipped) | codebase/frontend/index.html:310 · [source](../../codebase/frontend/index.html#L310) |
| % | % | name only (selected option, when clipped) | codebase/frontend/index.html:339 · [source](../../codebase/frontend/index.html#L339) |
| px (source) | px (source) | name only (selected option, when clipped) | codebase/frontend/index.html:339::2 · [source](../../codebase/frontend/index.html#L339) |
| % | % | name only (selected option, when clipped) | codebase/frontend/index.html:346 · [source](../../codebase/frontend/index.html#L346) |
| px (source) | px (source) | name only (selected option, when clipped) | codebase/frontend/index.html:346::2 · [source](../../codebase/frontend/index.html#L346) |
| + | Vignette center. Arrow keys move by one percent; Shift plus arrow moves by five percent. | name only (fallback) | codebase/frontend/index.html::#vignette-center-handle · [source](../../codebase/frontend/index.html#L461) |
| Navigator: pan using image overview | Click or drag to pan the image | fixed | codebase/frontend/index.html::#navigation-thumb · [source](../../codebase/frontend/index.html#L481) |
| span | Drag to move the Navigate window | fixed | codebase/frontend/index.html:482 · [source](../../codebase/frontend/index.html#L482) |
| Resize analysis dock | Resize analysis dock | name only (fallback) | codebase/frontend/index.html::#dock-splitter · [source](../../codebase/frontend/index.html#L487) |
| Resize grade rail | Resize grade rail | name only (fallback) | codebase/frontend/index.html::#grade-splitter · [source](../../codebase/frontend/index.html#L587) |
| Close help | Close | fixed | codebase/frontend/index.html::#help-close · [source](../../codebase/frontend/index.html#L1989) |
| Close presets | Close | fixed | codebase/frontend/index.html::#group-preset-close · [source](../../codebase/frontend/index.html#L2003) |

### analysis-dock

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Histogram | Histogram | name only (selected option, when clipped) | codebase/frontend/index.html:504 · [source](../../codebase/frontend/index.html#L504) |
| Waveform | Waveform | name only (selected option, when clipped) | codebase/frontend/index.html:505 · [source](../../codebase/frontend/index.html#L505) |
| Vectorscope | Vectorscope | name only (selected option, when clipped) | codebase/frontend/index.html:506 · [source](../../codebase/frontend/index.html#L506) |
| Technical | Technical | name only (selected option, when clipped) | codebase/frontend/index.html:507 · [source](../../codebase/frontend/index.html#L507) |
| Diagnostics | Diagnostics | name only (selected option, when clipped) | codebase/frontend/index.html:508 · [source](../../codebase/frontend/index.html#L508) |
| Composite | Composite | name only (selected option, when clipped) | codebase/frontend/index.html:511 · [source](../../codebase/frontend/index.html#L511) |
| Luma | Luma | name only (selected option, when clipped) | codebase/frontend/index.html:512 · [source](../../codebase/frontend/index.html#L512) |
| RGB Parade | RGB Parade | name only (selected option, when clipped) | codebase/frontend/index.html:513 · [source](../../codebase/frontend/index.html#L513) |
| Performance Detailed Reference | Balances scope resolution and responsiveness. Detailed is recommended; Reference is intended for faster systems. | fixed | codebase/frontend/index.html::#scope-detail · [source](../../codebase/frontend/index.html#L517) |
| Performance | Performance | name only (selected option, when clipped) | codebase/frontend/index.html:518 · [source](../../codebase/frontend/index.html#L518) |
| Detailed | Detailed | name only (selected option, when clipped) | codebase/frontend/index.html:519 · [source](../../codebase/frontend/index.html#L519) |
| Reference | Reference | name only (selected option, when clipped) | codebase/frontend/index.html:520 · [source](../../codebase/frontend/index.html#L520) |
| 1K nits | 1K nits | name only (selected option, when clipped) | codebase/frontend/index.html:526 · [source](../../codebase/frontend/index.html#L526) |
| 4K nits | 4K nits | name only (selected option, when clipped) | codebase/frontend/index.html:527 · [source](../../codebase/frontend/index.html#L527) |
| 10K nits | 10K nits | name only (selected option, when clipped) | codebase/frontend/index.html:528 · [source](../../codebase/frontend/index.html#L528) |
| Collapse Scopes panel | Collapse Scopes | fixed | codebase/frontend/index.html::#dock-collapse · [source](../../codebase/frontend/index.html#L533) |

### adjustment controls

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| control aria-label | label | dynamic expression; name/status supplied at runtime | codebase/frontend/adjustment-controls.js:527 · [source](../../codebase/frontend/adjustment-controls.js#L527) |
| dot aria-label | &#96;Reset ${label} to ${HDRFilmCharacter.owned.includes(key) ? "the stock" : "the baseline"}&#96; | dynamic expression | codebase/frontend/adjustment-controls.js:528 · [source](../../codebase/frontend/adjustment-controls.js#L528) |
| key — text used by dynamic tooltips | path.replace("shared.geometry.", "") | dynamic supporting definition | codebase/frontend/adjustment-controls.js:359 · [source](../../codebase/frontend/adjustment-controls.js#L359) |
| dot.title | &#96;Mod. Reset ${label} to ${HDRFilmCharacter.owned.includes(key) ? "the stock" : "the baseline"}&#96; | dynamic expression | codebase/frontend/adjustment-controls.js:529 · [source](../../codebase/frontend/adjustment-controls.js#L529) |
| control.title | film.film_stock === "none" ? "Neutral has no halation of its own; these are absolute effect controls." : "100% is this stock's own value; Hue Offset 0 keeps its colour. Set values stay fixed when changing stock." | dynamic expression | codebase/frontend/adjustment-controls.js:530 · [source](../../codebase/frontend/adjustment-controls.js#L530) |
| summary.title | summaries[name] | dynamic expression | codebase/frontend/adjustment-controls.js:584 · [source](../../codebase/frontend/adjustment-controls.js#L584) |
| summaries — text used by dynamic tooltips | { camera:text("grain_film_format")+(film.lens_filter === "none" ? "" : &#96; · ${text("lens_filter")} ${grade}&#96;), negative:(film.grain_enabled ? &#96;Grain ${Math.round(film.grain_amount)}&#96; : "No grain")+" · "+(film.halation_enabled ? &#96;Halation ${Math.round(HDRFilmCharacter.toUi(film, "halation_amount", film.halation_amount))}%&#96; : "No halation"), development:film.push_pull === 0 ? "Normal" : film.push_pull &gt; 0 ? &#96;Push +${film.push_pull}&#96; : &#96;Pull ${film.push_pull}&#96;, print:slide ? "No print" : paper+(film.stock_print_warmth ? film.stock_print_warmth &gt; 0 ? " · Warm" : " · Cool" : ""), scan:(film.lab_levels ? "Lab levels" : "Clean")+(film.scan_sharpening ? &#96; · Sharpen ${film.scan_sharpening}&#96; : "")} | dynamic supporting definition | codebase/frontend/adjustment-controls.js:575 · [source](../../codebase/frontend/adjustment-controls.js#L575) |
| grade — text used by dynamic tooltips | {0.125:"1/8", 0.25:"1/4", 0.5:"1/2", 1:"1", 2:"2"}[film.lens_strength] &#124;&#124; Number(film.lens_strength).toFixed(2) | dynamic supporting definition | codebase/frontend/adjustment-controls.js:574 · [source](../../codebase/frontend/adjustment-controls.js#L574) |
| slide — text used by dynamic tooltips | film.film_stock !== "none" && character.default_paper === null | dynamic supporting definition | codebase/frontend/adjustment-controls.js:546 · [source](../../codebase/frontend/adjustment-controls.js#L546) |
| paper — text used by dynamic tooltips | paperName(film.print_paper === "default" ? character.default_paper : film.print_paper) | dynamic supporting definition | codebase/frontend/adjustment-controls.js:556 · [source](../../codebase/frontend/adjustment-controls.js#L556) |
| modified.title | count ? &#96;${count} modified controls&#96; : "" | dynamic expression | codebase/frontend/adjustment-controls.js:587 · [source](../../codebase/frontend/adjustment-controls.js#L587) |

### app state

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| branchCopy / hdr | Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side. | fixed (dynamic lookup) | codebase/frontend/app-state.js:1405 · [source](../../codebase/frontend/app-state.js#L1405) |
| branchCopy / sdr | Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side. | fixed (dynamic lookup) | codebase/frontend/app-state.js:1406 · [source](../../codebase/frontend/app-state.js#L1406) |

### control panel

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| actions aria-label | Mask actions | name only (fallback candidate) | codebase/frontend/control-panel.js:40 · [source](../../codebase/frontend/control-panel.js#L40) |
| note.title | hint | dynamic expression | codebase/frontend/control-panel.js:137 · [source](../../codebase/frontend/control-panel.js#L137) |
| Foldout title | Default | fixed | codebase/frontend/control-panel.js:56 · [source](../../codebase/frontend/control-panel.js#L56) |
| Foldout title | hint | dynamic expression | codebase/frontend/control-panel.js:127 · [source](../../codebase/frontend/control-panel.js#L127) |

### group presets

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| button aria-label | Presets | name only (fallback candidate) | codebase/frontend/group-presets.js:46 · [source](../../codebase/frontend/group-presets.js#L46) |
| row aria-label | preset.name | dynamic expression; name/status supplied at runtime | codebase/frontend/group-presets.js:181 · [source](../../codebase/frontend/group-presets.js#L181) |
| name — text used by dynamic tooltips | answer.trim().replace(/\s+/g," ") | dynamic supporting definition | codebase/frontend/group-presets.js:351 · [source](../../codebase/frontend/group-presets.js#L351) |
| answer — text used by dynamic tooltips | await window.HDRDialogs.prompt("Preset name",preset.name,{title:"Rename preset",confirmLabel:"Rename"}) | dynamic supporting definition | codebase/frontend/group-presets.js:349 · [source](../../codebase/frontend/group-presets.js#L349) |

### info panels

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| dd.title | String(value ?? "") | dynamic expression | codebase/frontend/info-panels.js:357 · [source](../../codebase/frontend/info-panels.js#L357) |

### lanes compare

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| els.viewerBranchNote.textContent | branchCopy[lane] | dynamic expression | codebase/frontend/lanes-compare.js:254 · [source](../../codebase/frontend/lanes-compare.js#L254) |
| els.viewerBranchNote.textContent | &#96;${branchCopy[other]} Release V to return to the authored preview.&#96; | dynamic expression | codebase/frontend/lanes-compare.js:388 · [source](../../codebase/frontend/lanes-compare.js#L388) |
| other — text used by dynamic tooltips | state.currentView === "hdr" ? "sdr" : "hdr" | dynamic supporting definition | codebase/frontend/lanes-compare.js:413 · [source](../../codebase/frontend/lanes-compare.js#L413) |

### overlay ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| overlayToggle aria-label | active ? &#96;Overlays on: ${mode === "false_color" ? "False Color" : "Zebra"}&#96; : "Overlays off" | dynamic expression | codebase/frontend/overlay-ui.js:11 · [source](../../codebase/frontend/overlay-ui.js#L11) |
| active — text used by dynamic tooltips | mode === "false_color" &#124;&#124; mode === "zebra" | dynamic supporting definition | codebase/frontend/overlay-ui.js:7 · [source](../../codebase/frontend/overlay-ui.js#L7) |
| mode — text used by dynamic tooltips | state.adjustments.shared.overlay_mode &#124;&#124; "off" | dynamic supporting definition | codebase/frontend/overlay-ui.js:6 · [source](../../codebase/frontend/overlay-ui.js#L6) |

### photo framing ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| field aria-label | &#96;${name==="frame"?"Frame":"Border"} thickness in ${layer.unit==="percent"?"percent of cropped photo shorter side":"cropped source pixels"}&#96; | dynamic expression | codebase/frontend/photo-framing-ui.js:30 · [source](../../codebase/frontend/photo-framing-ui.js#L30) |

### preview pipeline

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| replacement aria-label | canvas.getAttribute("aria-label") &#124;&#124; "Settled comparison preview" | dynamic expression | codebase/frontend/preview-pipeline.js:944 · [source](../../codebase/frontend/preview-pipeline.js#L944) |

### range controls

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| element.title | &#96;Double-click or press Enter to type a value. Manual range: ${rangeText}.&#96; | dynamic expression | codebase/frontend/range-controls.js:151 · [source](../../codebase/frontend/range-controls.js#L151) |
| element aria-label | &#96;${label()}. Press Enter to edit. Manual range ${rangeText}.&#96; | dynamic expression | codebase/frontend/range-controls.js:152 · [source](../../codebase/frontend/range-controls.js#L152) |

### scope drawing

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| canvas aria-label | els.scopeTitle.textContent | dynamic expression; name/status supplied at runtime | codebase/frontend/scope-drawing.js:19 · [source](../../codebase/frontend/scope-drawing.js#L19) |
| canvas.title | scopeGuideTooltip(scope) | dynamic expression | codebase/frontend/scope-drawing.js:29 · [source](../../codebase/frontend/scope-drawing.js#L29) |

### scope ui

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| Scope guide tooltip builder | function guideTooltip(scope) { if (scope?.scope_type === "vectorscope") { return "Chroma direction and saturation. Distance from center indicates saturation."; } const labeledGuides = guidesForDisplay(scope); const guides = (scope?.guides &#124;&#124; []).filter((guide) =&gt; labeledGuides.has(Number(guide.value))); if (!guides.length) return ""; const descriptions = guides.map((guide) =&gt; { const shortLabel = compactGuideLabel(scope, guide); if (scope.preview_kind !== "hdr") return &#96;${shortLabel} output&#96;; if (/\bactive\b/i.test(guide.label)) return &#96;${shortLabel}: active HDR reference white&#96;; const detail = String(guide.label &#124;&#124; "").replace(/^\s*[\d.]+\s*/, "").trim(); if (detail === "nit") return &#96;${shortLabel}: 1 nit&#96;; return detail ? &#96;${shortLabel}: ${detail}&#96; : &#96;${shortLabel}: ${Number(guide.value)} nits&#96;; }); return &#96;Scope guides — ${descriptions.join("; ")}. RW means active HDR reference white.&#96;; } | dynamic template | codebase/frontend/scope-ui.js:53 · [source](../../codebase/frontend/scope-ui.js#L53) |

### session import

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| els.lensSettingsNote.dataset.tooltip | applied?.applied ? &#96;Applied ${applied.profile?.lens_maker &#124;&#124; ""} ${applied.profile?.lens_model &#124;&#124; "selected profile"}. Re-development is required after changing these controls.&#96; : applied?.warning &#124;&#124; applied?.reason &#124;&#124; "Auto applies only one exact profile match. Off and Manual are always available." | dynamic expression | codebase/frontend/session-import.js:461 · [source](../../codebase/frontend/session-import.js#L461) |
| module.title | available ? "" : unavailableReason | dynamic expression | codebase/frontend/session-import.js:481 · [source](../../codebase/frontend/session-import.js#L481) |
| option.title | &#96;${profile.mount &#124;&#124; "Unknown mount"} · ${profile.distortion ? "distortion" : "no distortion data"} · ${profile.chromatic_aberration ? "CA" : "no CA data"} · ${profile.vignetting ? "vignetting" : "no vignetting data"}&#96; | dynamic expression | codebase/frontend/session-import.js:540 · [source](../../codebase/frontend/session-import.js#L540) |
| els.lensSettingsNote.dataset.tooltip | Save or relink the durable source before re-development. | fixed | codebase/frontend/session-import.js:593 · [source](../../codebase/frontend/session-import.js#L593) |
| els.lensSettingsNote.dataset.tooltip | Choose a manual Lensfun profile or switch to Auto/Off. | fixed | codebase/frontend/session-import.js:597 · [source](../../codebase/frontend/session-import.js#L597) |

### status manager

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| overflowNode.title | folded.map((record) =&gt; record.entry.message).join(" · ") | dynamic expression | codebase/frontend/status-manager.js:38 · [source](../../codebase/frontend/status-manager.js#L38) |
| copy.title | normalized.message | dynamic expression | codebase/frontend/status-manager.js:124 · [source](../../codebase/frontend/status-manager.js#L124) |
| normalized — text used by dynamic tooltips | { ...entry, id: String(entry.id), severity, message: String(entry.message &#124;&#124; "") } | dynamic supporting definition | codebase/frontend/status-manager.js:106 · [source](../../codebase/frontend/status-manager.js#L106) |
| severity — text used by dynamic tooltips | SEVERITIES.has(entry.severity) ? entry.severity : "info" | dynamic supporting definition | codebase/frontend/status-manager.js:105 · [source](../../codebase/frontend/status-manager.js#L105) |
| SEVERITIES — text used by dynamic tooltips | new Set(["info", "progress", "success", "error", "attention"]) | dynamic supporting definition | codebase/frontend/status-manager.js:5 · [source](../../codebase/frontend/status-manager.js#L5) |
| progress aria-label | normalized.progressLabel &#124;&#124; normalized.message &#124;&#124; "Progress" | dynamic expression | codebase/frontend/status-manager.js:131 · [source](../../codebase/frontend/status-manager.js#L131) |
| button aria-label | action.label | dynamic expression; name/status supplied at runtime | codebase/frontend/status-manager.js:149 · [source](../../codebase/frontend/status-manager.js#L149) |
| button.dataset.tooltip | action.label | dynamic expression; name/status supplied at runtime | codebase/frontend/status-manager.js:152 · [source](../../codebase/frontend/status-manager.js#L152) |
| dismiss aria-label | &#96;Dismiss ${normalized.message}&#96; | dynamic expression | codebase/frontend/status-manager.js:162 · [source](../../codebase/frontend/status-manager.js#L162) |

### tooltips

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| element aria-label | text | dynamic expression | codebase/frontend/tooltips.js:21 · [source](../../codebase/frontend/tooltips.js#L21) |
| element.dataset.nativeTooltip | text | dynamic expression | codebase/frontend/tooltips.js:24 · [source](../../codebase/frontend/tooltips.js#L24) |
| element aria-label | text | dynamic expression | codebase/frontend/tooltips.js:26 · [source](../../codebase/frontend/tooltips.js#L26) |

### workspace layout

| Control / visible name | Text | Flags | ID and source |
| --- | --- | --- | --- |
| sourceRailExpand aria-label | collapsed ? "Expand source metadata" : "Collapse source metadata" | dynamic expression | codebase/frontend/workspace-layout.js:52 · [source](../../codebase/frontend/workspace-layout.js#L52) |
| els.sourceRailExpand.title | collapsed ? "Expand metadata" : "Collapse metadata" | dynamic expression | codebase/frontend/workspace-layout.js:53 · [source](../../codebase/frontend/workspace-layout.js#L53) |
| dockCollapse aria-label | &#96;${action} Scopes panel&#96; | dynamic expression | codebase/frontend/workspace-layout.js:279 · [source](../../codebase/frontend/workspace-layout.js#L279) |
| action — text used by dynamic tooltips | expanded ? "Collapse" : "Expand" | dynamic supporting definition | codebase/frontend/workspace-layout.js:277 · [source](../../codebase/frontend/workspace-layout.js#L277) |
| els.dockCollapse.title | &#96;${action} Scopes&#96; | dynamic expression | codebase/frontend/workspace-layout.js:280 · [source](../../codebase/frontend/workspace-layout.js#L280) |

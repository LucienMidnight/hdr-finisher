# Photo Library PRD (brainstorm notes)

Started October 9, 2026. Status: **brainstorm, not a build brief.** These are
working notes from a conversation between Steve and Claude. They get organised
into proper requirements later. Nothing here is approved for implementation.

## Direction

HDR Finisher grows from a finishing-only tool into a full editor. The name
stays. The missing piece is a library: a place to browse, cull, rate, compare
and batch-export photos without leaving the app.

Reference Steve shared: DxO PhotoLab's PhotoLibrary (folder tree on the left,
thumbnail grid along the bottom with star ratings, split compare in the
viewer). The useful parts are the folder-first browsing and the quick compare.
The goal is the same jobs with far less on screen.

## What Steve asked for

- Library is a **separate window** that can be snapped or made full screen on a
  second monitor.
- **No import step.** Browse folders like Explorer. Add **albums** and
  **pinned folders** on top. Albums are lists of image paths kept in the
  database.
- A **database** for library-level data plus **sidecar files** for per-image
  data, so adjustments stay with the image and are easy to move around.
- **Fast RAW thumbnails.** The current import window already does this well on
  Windows.
- **Batch export.**
- **HDR and SDR preview modes.**
- **Several browser layouts.**
- **Tagging, star rating, pick/reject.**
- **Sort and filter.**
- **Focus / sharpness overlay** that reads clearly even on thumbnails.
- Added during the session: autosave option, virtual copies, selective
  copy/paste of grades, look presets, smart albums, full camera and lens
  metadata, portable projects, file and folder controls, background indexing,
  on-request HDR previews, export recipes, exposure and clipping overlay, tag
  management, metadata authoring, full-screen review, library undo, and an
  MCP server before 1.0. Each has its own section below.
- **Comparison:** pin one image, flip through alternates at the same zoom, side
  by side.
- **Minimal look.** The tools must not clutter the screen.
- **Entry point:** the Import button becomes **Library**. It opens the library
  where the preview is now. A pop-out button moves the library to its own
  window and switches the main window to Grade.

## Technical feasibility: the separate window

Short answer: **one app, two windows. No second Electron instance needed.**

What is there today:

- The desktop shell (`codebase/desktop/main.js`) starts one Python backend and
  opens one window that loads the interface from it.
- The existing file browser, pinned folders, recents and thumbnail cache all
  live in the backend (`backend/hdr_finisher/media_browser.py`), not in the
  window. A second window can use them as they are.

How the two-window version would work:

- The shell opens a second window that loads a library page from the same
  backend. Both windows talk to the same backend, so they see the same pins,
  thumbnails, ratings and albums.
- The library is built once as a self-contained piece of the interface. Docked
  mode shows it inside the main window; popped-out mode shows the same piece
  in its own window. One library, two places to put it.
- The windows tell each other things ("open this photo in Grade", "rating
  changed", "export finished") through the shell or the backend.
- Windows snapping, maximise and full screen on a second monitor come for free
  with a normal window. The app should remember which monitor the library was
  on and how big it was.

Work this creates:

- The shell is written around a single window (close handling, unsaved-changes
  prompts, menus, display detection). It needs to learn about a second one.
  Moderate work, well understood.
- Rules to settle: closing the main window closes the library; closing the
  library window just puts it away (or re-docks it).
- Each window has its own graphics context. The library window showing HDR
  images on a different monitor needs its own HDR display detection, because
  the two monitors can have different brightness and HDR ability.
- Memory: a second window costs some RAM and video memory. The library should
  hold only small previews, not full-resolution working images.

Risk: low for the window itself. The harder parts are below (previews of
edited images, HDR in the grid, and the save model).

## Thumbnails and previews

Today: RAW files use the small JPEG the camera embeds in the file. Thumbnails
are made on demand, capped at 512 px, cached on disk by path + size +
modified time, and two are decoded at a time. Thumbnails are SDR on purpose.

Where thumbnails live (clarified October 9 after Steve asked):

- **Never next to the photos.** The only file the app adds to a photo folder
  is the sidecar. Thumbnails, larger previews and focus maps go in one cache
  folder in the app's own data area, as they do today.
- **Made when first looked at**, then reused. Background indexing does not
  make thumbnails unless an "prepare thumbnails ahead" option is switched on.
- The cache is disposable. Deleting it loses nothing; thumbnails are made
  again when needed. Projects and sidecars moved to another machine do not
  carry thumbnails; that machine makes its own.
- To settle: a size limit with oldest-unused removed first; whether the cache
  location can be moved to another drive; and that today's cache is keyed by
  file path, so a moved or renamed photo gets its thumbnail remade (keying by
  photo ID or content would avoid that).

### HDR in the grid (Steve's direction, October 9)

- **The grid is SDR by default.** Automatic HDR thumbnails would be slow and
  heavy, because an unedited RAW has to be developed to get an HDR picture.
- **"Create HDR previews" is a command the user runs** on a folder, album or
  selection. It works in the background; each thumbnail switches to HDR the
  moment its preview is ready. The user can go and do something else, come
  back, browse the folder in HDR, make picks and then edit.
- **Cache limit set by the user.** Previews stay until the limit is reached,
  then the oldest are removed first, **in batches** (clear a good margin
  below the limit in one go) so the app is not constantly deleting and
  remaking.

Claude's additions, proposed:

- These previews show **HDR Finisher's rendering**, not the camera's JPEG:
  the default look for unedited photos, the user's grade for edited ones. So
  the same command also answers "the browsing look does not match the opened
  look".
- **Build a screen-sized HDR preview, not only a thumbnail,** and shrink the
  thumbnail from it. Picking between similar shots happens in single view and
  compare, and that is where instant HDR matters most. **Agreed by Steve,
  October 9, with a resolution limit:** never store full-size (for example
  8K) HDR images as previews.
  - Proposed limit: 2560 pixels on the long edge by default, with a setting
    (for example 1920 / 2560 / 3840). Final numbers after the speed and disk
    measurement.
  - The preview covers "fit to window". Zooming in past it, such as a 100%
    focus check, falls back to the camera's embedded full-size JPEG or
    develops that one photo on demand.
  - Smaller limit means more photos fit in the cache before old ones are
    cleared.
- "Oldest" should mean least recently looked at, not first created.
- The job follows the background rules: low priority, gives way to grading
  and export, uses the graphics card only when it is idle. Progress, pause
  and cancel. Survives closing the app and carries on next time (idea).
- A photo whose grade changes gets its HDR preview remade.
- While the job runs the grid is a mix of SDR and HDR tiles. Acceptable; a
  small mark on tiles that are ready would help.
- The library's HDR/SDR switch still decides whether ready HDR previews are
  shown.
- **Comfort cap. Agreed by Steve, October 9: the HDR grid is limited to
  1000 nits by default**, user-adjustable. Keeps a wall of highlights
  comfortable. No effect on a display that peaks lower. To settle: whether
  brighter highlights are rolled off smoothly or simply clipped (lean: rolled
  off), and whether the cap applies to the grid only (lean: yes; single view
  and compare show the true image).
- **Must test later (Steve):** seconds per RAW and disk space per preview, on
  Steve's real files. Do not promise how long a folder takes before then.
- **If it proves fast enough, prefer a simple HDR toggle** for the grid that
  builds previews automatically for whatever is on screen, instead of making
  users build them folder by folder. The explicit command then stays as the
  way to prepare a folder ahead of time. Decide after the measurement.
- Multi-select of folders (see File and folder controls) lets the command run
  on several folders at once.

### Zooming in for a focus check: what other apps do

Steve asked, October 9. From Claude's general knowledge of these apps, not
re-checked against current versions.

- **Lightroom Classic:** keeps screen-sized "standard" previews. Zooming to
  100% in the Library builds a full-size "1:1" preview on demand, which is
  the familiar "Loading..." pause. 1:1 previews can be built ahead for a
  folder and are thrown away after a set time to save disk.
- **Capture One:** keeps previews at a size the user sets. Zooming past that
  size loads the full image on demand.
- **Photo Mechanic:** never develops the RAW. It shows the JPEG the camera
  embedded, which is why it is the fastest culler. Its 100% view is only as
  good as that embedded JPEG.
- **FastRawViewer:** decodes the actual RAW quickly for each photo as it is
  viewed, so the focus check is on real sensor data.
- **DxO PhotoLab:** shows a quick preview, then renders its corrections on
  demand when zoomed in, with a visible wait.

So the common pattern is what these notes already propose: a cached
screen-sized preview for browsing, full resolution only on demand, optionally
prepared ahead. Nobody keeps full-size previews of everything permanently.

**The embedded JPEG cannot be relied on.** Its size varies by camera and
model: some embed a full-size one, some only a small one (around 1600 pixels
wide), some formats none at all. So no feature may depend on it. See the
generic rule below.

### Proposed approach for zoom and focus: three tiers

After Steve asked whether FastRawViewer's method is the most performant
(October 9). Claude's view, to be confirmed by measurement:

- Pulling out the embedded JPEG is always the fastest thing possible, because
  nothing is developed. But it is only useful at 100% when the camera embeds
  a large one, and it is the camera's sharpened, noise-reduced picture.
- FastRawViewer's method (a quick, plain decode of the RAW) is the fastest
  way to see **true** detail. As Steve noted, it is needed anyway whenever
  the embedded JPEG is too small. So plan around it, and treat a large
  embedded JPEG as a bonus.

**Requirement from Steve, October 9: the solution must be generic, not suited
to one camera.**

- The same method for every camera and every supported format. Nothing is
  designed around what a particular camera happens to embed.
- The quick plain decode (tier 2) is the method everything can rely on. Focus
  maps always come from it, so the overlay and any sharpness figure mean the
  same thing on every camera.
- The embedded JPEG is only ever a head start. For each file the app checks
  what is actually there and uses it if it is big enough for the size being
  shown; if not, it goes straight to tier 2. No per-camera lists or special
  cases.
- Files that are not RAW (EXR, TIFF, HEIC, AVIF, JXL, JPEG, PNG) follow the
  same three steps with their own quick decode.
- Measurements and testing use a spread of cameras and formats: several
  brands, compressed and uncompressed RAW, low and very high pixel counts.
  Steve's own files are one sample among them, not the target.

Tiers:

1. **Embedded JPEG, instantly**, as the picture shown first at any size.
2. **Quick plain RAW decode** for zooming in and for focus maps. No grade, no
   denoise, simplest reconstruction. Swaps in when ready.
3. **Full HDR Finisher rendering** only for Grade and for HDR previews.

Why tier 2 is worth building well:

- Focus judged on real sensor data, the same way on every camera, without
  the camera's own sharpening flattering a soft shot.
- It is the first step of making an HDR preview anyway, so the work is
  shared.
- **Read ahead:** while comparing, decode the next and previous photos in the
  background so flipping feels instant even if one decode takes a moment.
  Keep only a few decoded photos in memory; they are large.
- A lower-resolution decode is much quicker than a full one and is enough for
  "fit to window" and for the focus map; the full decode is only for a true
  100% view.
- Later option: do the decode on the graphics card, in keeping with GPU
  first.

Honest limit: FastRawViewer is a specialist tool tuned for exactly this. We
should not expect to match its speed at first. Measure decode time, quick and
full, across the spread of cameras and formats before fixing the design.

What a library needs beyond that:

- **A grid that only draws what is on screen**, so a folder of thousands scrolls
  smoothly. Requests for thumbnails that scrolled away get dropped.
- **More than two decodes at once**, with what is on screen first.
- **Bigger previews** for the single-image view and compare. Most cameras embed
  a large JPEG (often full resolution) in the RAW. That gives an instant 100%
  view for checking focus, without developing the RAW.
- **Edited images must show their edit.** The camera's embedded JPEG shows the
  camera's look, not HDR Finisher's. Once a photo has adjustments, the library
  needs a preview rendered by HDR Finisher and saved to the cache. Idea: save
  it when the photo is closed or when the grade settles.
- **Unedited images:** camera JPEG (instant, but not our look) or our default
  rendering (correct, but each one takes real time)? Probably camera JPEG
  first, upgraded in the background. Open question.
- **HDR previews.** Idea worth testing: store the cached preview as a small
  gain-map image. One file then serves both SDR and HDR preview modes, and the
  app already knows how to make gain maps.
- A whole grid in HDR may be hard on the eyes. Possible rule: grid is SDR by
  default with a toggle; single view and compare follow the HDR/SDR mode.
- "Works well on Windows" has to be re-checked on macOS and Linux.

## Where the data lives

Proposal: **sidecar files are the truth; the database is a fast index that can
be rebuilt from them.**

- **Sidecar** (one small file next to each image): adjustments, rating,
  pick/reject, tags. Travels with the photo when the folder is moved, copied
  or backed up.
- **Database** (one file in the app's data folder): albums, pinned folders,
  layout preferences, and a searchable copy of what the sidecars and camera
  metadata say, so sort and filter are instant.
- If the database is lost or damaged, nothing that matters is lost. It gets
  rebuilt by reading folders again. Only albums need care (see below).

Useful fact: today's project file (`.hdrfinisher`) is **already nearly a
sidecar.** It holds only settings, never pixels, and points at the original
image by path plus a fingerprint. The sidecar could be the same document saved
next to the photo under a predictable name, looking for its photo beside itself
first. That reuses what exists instead of inventing a second format.

Things to work out:

- **Sidecar location. Decided by Steve, October 9: next to the photo.** One
  small file beside each rated or edited photo. Easy to keep track of and move
  together in Explorer. The library hides sidecars while browsing, so they
  never show as items in the grid.
- **Sidecar naming.** Proposed: the photo's full file name plus our ending
  (`DSC02339.ARW.hdrfinisher`). Keeping the `.ARW` part means a RAW and a JPEG
  with the same name each get their own sidecar, and the sidecar sorts right
  beside its photo in Explorer.
- Moving a photo in Explorer without its sidecar leaves an orphan sidecar
  behind. The library could notice orphans and offer to reconnect them using
  the photo ID. Later nicety.
- **When a sidecar is created.** Only when the photo gets a rating, tag or
  edit. Just looking at a folder writes nothing.
- **Folders that cannot be written** (memory cards, read-only network drives):
  fall back to keeping that photo's data in the database, and say so.
- **Albums and moved files.** An album is a list of paths. If photos are moved
  in Explorer, the paths go stale. Fix: give each photo a small ID inside its
  sidecar, so the album can find it again when the new folder is browsed. A
  photo with no sidecar has no ID, so adding to an album might need to create
  one.
- **Other apps' ratings. Decided by Steve, October 9: ignore them for now.**
  HDR Finisher keeps its own ratings and neither reads nor writes the stars
  that Lightroom, DxO or the camera store. May be revisited later.
- **More than one version of a photo** (virtual copies). Not asked for; the
  sidecar naming should not rule it out.
- **Moving, renaming and deleting inside the library** should carry the sidecar
  along. Delete goes to the Recycle Bin.
- Per the pre-1.0 rule, no migration code. Existing saved projects keep opening
  as they do now; whether they show up in the library is an open question.

## The save model changes (important)

Today the app works like a document editor: open one image, Save / Save As a
project, get an unsaved-changes warning. A library does not fit that on its
own, because flipping between photos has to be quick and safe.

**Decided by Steve, October 9: autosave is an option the user switches on or
off.**

- **Autosave on:** adjustments save themselves to the sidecar a moment after
  the last change, and always when leaving the photo or closing the app. No
  Save prompts. This is the Lightroom / DxO feel.
- **Autosave off:** nothing is written until the user saves. For careful work
  (a professional job, trying a run of ideas) where the saved grade should
  only change on purpose.
- Steve switches between the two depending on the job, so the switch must be
  quick to reach and its state always visible (a small indicator, not buried
  in Settings).

**Decided by Steve, October 9: with autosave off, the prompt appears only when
switching the photo in Grade.**

- Only **one photo is open in Grade at a time**, and only that photo can have
  unsaved work. So there is never a pile of unsaved photos.
- **Single click in the library** selects and navigates. It never loads a
  photo into Grade and never prompts.
- **Double-click (or Enter)** asks Grade to switch to that photo. If the photo
  in Grade has unsaved work, the switch is held and a window asks: Save,
  Don't save, or Cancel. Cancel leaves everything as it was.
- **Browsing, culling and comparing change no adjustments**, so they never
  prompt. Intent of the rule: the grade of a photo changes only through
  something done in the Grade panel.
- The same check applies to the other ways of leaving the open photo: closing
  the app, closing the main window, opening a different virtual copy of the
  same photo.

Details to work out:

- **Ratings, picks, tags and album membership always save at once**, whatever
  the autosave setting. They are library marks, not adjustments, and marking
  the photo that is open in Grade does not count as unsaved work.
- **Library commands that change grades** (paste a grade onto a selection,
  apply a look preset, sync) are the exception to "only the Grade panel".
  **Decided by Steve, October 9: they save straight away**, whatever the
  autosave setting, with a confirmation naming how many photos will change
  and one undo for the whole action. If the photo open in Grade is among
  them, the change lands there as ordinary unsaved work instead.
- **"Before" safety net (decided):** before such a command rewrites a photo's
  grade, the previous grade is kept in that photo's sidecar. It survives a
  restart, unlike undo.
- **Revert commands (Steve's addition):**
  - *Revert to original:* clear all adjustments, back to the untouched photo.
  - *Revert to last saved:* drop unsaved work on the open photo.
  - *Restore previous grade:* bring back the "before" state kept by the last
    library command.
  - Available in Grade and on a library selection. Reverting is itself kept
    as a "before" state, so a revert can be taken back.
  - *Revert to last session* (Steve, October 9): with autosave on, "last
    saved" is only seconds old and does little, so offer this as well. A
    session is to be defined in whatever way is simple. Proposed: a session is
    one run of the app. The first time a photo's grade changes in a run, its
    grade from before that change is kept as the session-start state. "Revert
    to last session" returns to it, so a day's work on a photo can be thrown
    away even after visiting other photos in between. Costs nothing for photos
    that are not touched.
  - To settle: how many "before" states to keep (one, or a short list), and
    whether the session-start state is kept after the app closes (lean: yes,
    until the next session changes that photo).
- **Thumbnail and export for the open photo with unsaved work:** the library
  shows and exports the saved grade. Batch export that includes it should say
  so and offer to save first.
- **Crash safety with autosave off:** keep a hidden recovery copy of the one
  open photo's unsaved work, offered back on next launch. Not the same as
  saving.
- Should the setting be global, or remembered per pinned folder (so a client
  job folder is always manual)? Idea only.
- Virtual copies (below) are the other way to "try a bunch of adjustments"
  safely, and work with autosave on.
- Existing Save / Save As project feature: still open what it becomes.

## Projects, and sharing grades between people and machines

Steve leans (October 9) toward **the sidecar replacing the Save / Save As
project file**, provided grades can still be shared between users and
machines. His idea: a Save As that gives the saved file a unique ID so it can
be shared without confusing the local machine.

Claude's thoughts, proposed and not yet confirmed:

Sharing is really three different jobs, and two are already covered.

1. **Same photo, another machine** (Steve's desktop to laptop, or sending a
   job to someone). Copy the photo and its sidecar together. The sidecar
   finds its photo beside itself, so it just works. This is the main payoff
   of keeping sidecars next to photos. Nothing extra to build.
2. **Share a look, not a photo.** That is a look preset, exported as a file.
   Already in these notes.
3. **Share the grade for a photo the other person already has**, without
   sending the photo again. This is the gap, and where Steve's idea fits.

For job 3, rather than a second sidecar with a new ID:

- **Export grade...** writes a standalone grade file, named and saved anywhere.
  It is a copy of the grade, not a live sidecar. The app never treats it as
  the home of a photo's grade, so there is no "which one is current?" on the
  local machine.
- **Import grade...** onto a photo adds it as a **new virtual copy** with a
  fresh ID. It never overwrites the grade already there. That delivers what
  Steve's unique ID is for: an incoming grade can never collide with or
  replace local work, even when file names match.
- The grade file carries the photo's fingerprint. If it is imported onto a
  different photo, the app warns and offers to apply it anyway as a look.
- Why not a renamed sidecar with a new ID: two sidecar-like files sitting
  beside one photo is exactly the confusion to avoid, and the ID that matters
  for albums belongs to the photo, which is the same photo on both machines.
  The IDs that need to be unique are the virtual copies', and import can
  issue those.
- The exported file must be self-contained: no machine-specific paths, and
  nothing that depends on presets or files only the sender has.
- Choice on export: include rating, pick and tags, or grade only.

### Steve's refinement: portable projects (October 9)

Steve proposed calling the export/import a **project**, modelled on DaVinci
Resolve. This supersedes the single "grade file" idea above; a one-photo
project does that job.

- **Export project** from a folder, an album, a selection or a single photo.
  The result is a **project folder**: sidecars, a small project index if
  needed, and optionally the source images (RAW, EXR and so on).
- Resolve parallel: project without media versus archive with media.
- **In the UI, projects sit in their own small section and behave like pinned
  folders.** A project is a mini library that is easy to hand over.
- Use: sending work between machines or people, and corporate jobs where a
  batch of images is converted to HDR as one deliverable.

Claude's thoughts, proposed and not yet confirmed:

- **It fits what is already decided.** With sidecars next to photos, a project
  that includes sources is just a folder of photos and sidecars plus one index
  file. Opening it needs no import step, only pinning and indexing. Keep it
  that thin: *a project is a pinned folder with a project file in it.*
- **What the index holds:** project name, the albums and photo order inside
  the project, smart album rules, and the export settings and look presets
  the job uses, so a corporate batch is self-contained. Grades stay in the
  sidecars. The index is never the only home of anything about one photo.
- **Double-clicking the project file in Explorer opens the app on that
  project.** This gives back "open a file as a working document".
- **Exporting is a copy.** Afterwards the project folder and the original
  folders are separate and can drift apart, as in Resolve. Say so at export.
- **Coming back:** when a colleague returns a project, "merge into my library"
  matches photos by ID and fingerprint and brings the returned grades in as
  new virtual copies. Nothing local is overwritten.
- **One mechanism for every "two sidecars, one photo" case:** a returned
  project, a NAS or cloud conflict copy, an orphan sidecar. Detect it, never
  pick a winner silently, bring the other one in as virtual copies.
- **Sidecars-only projects are the harder half.** The receiver must point the
  app at the originals. **Decided by Steve, October 9: the user chooses, merge
  or keep separate.**
  - *Merge:* each grade lands beside its original as a new virtual copy. The
    project folder was only the delivery package. Offer to create an album so
    the set stays together.
  - *Keep separate:* the project stays its own mini library pointing at photos
    elsewhere. This is the one place a grade does not live beside its photo,
    so the project must show clearly when its photos are missing.
- **Relinking missing sources (Steve, October 9).** Needs a reasonable manual
  path, not a polished one: Steve expects most people to use AI for this.
  - Point at a folder. The app searches it and its sub-folders and matches by
    file name, confirmed by fingerprint.
  - A plain list of what is still missing, with found / missing / wrong-file
    status per photo.
  - Pick a single file by hand for the stragglers. A fingerprint mismatch
    warns but can be overridden (re-exported or renamed sources).
  - Work can continue with some photos still missing; they show as offline.
  - A relink step already exists for today's single-image projects and can be
    the starting point.
  - Keep the project index and sidecars as plain readable text so an AI
    assistant, or a person with a text editor, can repair paths directly.
- **Exporting from an album that spans folders, with sources:** copies the
  photos (disk space; show the size first) and can hit two different photos
  with the same file name. Needs a rule (keep sub-folders, or rename).
- **Which virtual copies travel:** all, or only the selected ones.
- **Single photo by email:** option to pack the project folder into one file.
- **Naming.** "Project" today means the single-image `.hdrfinisher` file.
  Project index and sidecar should have different endings so Explorer can
  tell them apart. To settle.
- **Keep projects optional.** Everyday work is pinned folders and albums;
  nobody should feel they must create a project first.
- **Build order:** late. With-sources projects come nearly free once sidecars
  and pins exist; sidecars-only and merge-back are the real work.

Related gap this exposes: **albums and pins live in each machine's database
and do not travel.** Idea: also record album names in each photo's sidecar.
Then albums rebuild themselves on a second machine, and a lost database loses
nothing at all. Smart albums would still need an export of their rules.

Existing `.hdrfinisher` project files: the sidecar would be the same kind of
document, so they should keep opening. Check Steve's real projects before
promising that.

## Virtual copies

Requested by Steve, October 9 (a favourite Lightroom feature).

- Several independent grades of one photo, with no duplicate of the image
  file. Each copy appears in the grid as its own thumbnail with a small corner
  mark, sitting beside its original.
- Each copy has its own adjustments, crop, rating, pick status and tags, can
  go in albums on its own, and exports as its own file (name suffix).
- Create from the current grade ("duplicate") or from a clean start. Optional
  name per copy ("B&W", "client crop").
- **Do better than Lightroom here:** Lightroom keeps virtual copies only in
  its catalog, so they are lost if the catalog is. Ours should live in the
  sidecar and travel with the photo.
- Storage choice to make: one sidecar per photo holding all its copies (fewer
  files, moves as one piece), or one sidecar file per copy (closest to today's
  project file, but more files). Lean: one sidecar holding all copies.
- Each copy needs its own ID (albums point at a specific copy) and its own
  cached preview.
- Sort and filter treat a copy as an item. Option to collapse copies under
  the original as a stack.
- Compare view is a natural fit: two grades of the same photo side by side.
- Deleting the original photo from the library removes its copies too. Say so
  in the confirmation.
- Related later idea: snapshots (named saved states inside one copy). Not
  requested.

## Selective copy and paste of grades

Requested by Steve, October 9. Works from inside the library, on a selection.

- Copy the grade from one photo. Paste onto one or many.
- **Paste Special** opens a checkbox list of what to bring across. Adjustments
  are grouped to keep it short; each group twirls down for finer choices.
- A plain paste repeats the last set of ticks without opening the list.
- The app already splits the grade into 22 preset groups (tone, highlights,
  equalizer, colour, zones, curves, colour grading, film look, vignette,
  detail, black and white, denoise, each for HDR and for SDR, plus SDR base).
  Those are the natural twirl-down level. Suggested top level:
  - **Tone:** tone, highlights, equalizer, zones, curves
  - **Colour:** colour, colour grading, black and white
  - **Look:** film look, vignette
  - **Detail:** detail, denoise
  - **HDR side / SDR side** as a master pair of ticks, so "HDR grade only" is
    one click
  - **Outside the grade groups:** white balance and RAW development, lens
    corrections, crop and geometry, local adjustments and masks
- Why this is tricky (Steve called it):
  - **Masks and local adjustments** are placed on the picture. Pasted onto a
    different frame they land in the wrong place. Gradients and whole-image
    ranges carry over reasonably; brushed masks do not. Default: unticked.
  - **Crop** across different orientations or sizes. Default: unticked.
  - **Lens corrections** belong to the lens, not the look. Default: unticked.
  - **Image-dependent settings** (anything "auto" or matched to the picture,
    such as SDR match): copy the setting so it re-runs on the target, or copy
    the resulting numbers? Needs a rule per control.
  - **Different kinds of source** (RAW versus an HDR JPEG): some settings do
    not apply to the target. Skip those and say which.
  - **White balance** as a number only makes sense between shots in the same
    light. Its own tick.
- Pasting onto many photos edits photos that are not open. So it needs:
  progress, one undo for the whole paste, and thumbnails that refresh in the
  background afterwards.
- "Sync" (make the rest of the selection match the active photo) is the same
  feature with a different entry point.

## Look presets

Raised by Steve, October 9. DxO-style colour styling presets, applied from a
menu and then customised.

- Today presets exist **per panel** (one for curves, one for film look, and so
  on), saved as small files. There is no preset for a whole look.
- A look preset is a saved grade covering several panels at once.
- **One mechanism for three features:** a look preset is a selective copy that
  was saved with a name. The same checkbox list decides what a preset
  contains. Copy/paste, sync and presets then share one picker and one set of
  rules, which keeps the tricky part in one place.
- A preset only touches the groups it contains and leaves the rest of the
  grade alone. A colour-style preset would not change exposure or crop.
- Apply from: a menu in Grade, and right-click on a selection in the library
  (many photos at once).
- Customising: after applying, the values are ordinary slider values and can
  be changed freely. "Update preset from current" and "Save as new preset".
- Presets carry both an HDR and an SDR side where that makes sense.
- Organising: folders, favourites, rename, delete, export and import as files
  for sharing.
- A small set of built-in starter styles shipped with the app. Needs Steve's
  eye to design. Film look already has its own stocks; work out how the two
  relate so there are not two competing "looks" menus.
- Browsing presets: DxO shows a thumbnail of each preset on the current
  photo. Appealing, but each thumbnail is a render. Cheaper first step: live
  preview on hover, one at a time.
- Later ideas: a strength slider for an applied preset (hard to do honestly
  across mixed controls); a default preset applied to new photos, perhaps per
  camera.

## Browsing without import

- **Pinned folders are the navigation** (added by Steve mid-session). The left
  side does not show the whole drive tree. It shows only the folders Steve has
  pinned, each one expandable to its own sub-folders, plus albums. Pin
  `Photos\2026` and the tree starts there; the rest of the drive stays out of
  sight.
- **Adding a folder:** an "Add folder" control (a small + beside the Folders
  heading, and a menu item) opens a folder-picker window for navigating drives
  and choosing what to pin. The current import browser already does this kind
  of navigation and already stores pins, so the picker can be built from it.
- Right-click a pinned folder: unpin, rename the label, show in Explorer,
  re-scan. Right-click any sub-folder: pin it as its own top-level entry.
- Drag to reorder pins. A pin whose drive is unplugged stays listed, greyed
  out, so it comes back when the drive does (the current browser already keeps
  unavailable pins visible).
- Also accept a folder dragged in from Explorer as a new pin.
- Still needed: a way to look at a folder once without pinning it (a card just
  plugged in, a one-off download). Idea: the same picker with an "Open without
  pinning" choice, shown as a temporary entry until closed.
- First run has no pins. Empty state: one clear "Add a folder" prompt, perhaps
  offering Pictures as a suggestion.
- Folders are read live from disk. No "add to catalog".
- The database learns about a folder the first time it is opened, and keeps
  what it learned.
- Consequence to accept: **searching and filtering "everything" only covers
  folders the app has seen.** Pinned folders could be indexed in the background
  (including sub-folders) and watched for changes, which makes pins the way to
  say "this is part of my library" without an import step.
- Optional later: a simple "copy from card to a dated folder" helper. Not an
  import catalog, just a file copy.

## File and folder controls

**Required by Steve, October 9. Stated plainly so it is not skipped when this
becomes a build brief.** The library is not read-only: it can change files and
folders on disk.

Must have:

- **Rename a folder.**
- **Move a folder** (drag onto another folder, or a Move command).
- **Delete photos from disk**, always behind an "Are you sure?" window.
- **Multi-select photos** and **multi-select folders.** Ctrl-click, Shift-click
  for a range, select all, drag a box around thumbnails. Commands then apply
  to the whole selection (rate, tag, paste a grade, export, delete, create HDR
  previews for three folders at once).

What each one has to get right:

- **Everything attached travels with the file.** Moving or renaming carries
  the sidecar, so grades, ratings, tags and virtual copies stay attached. The
  database, pins, albums and cached thumbnails are updated to the new
  location so nothing has to be re-indexed or rebuilt.
- **Delete confirmation says exactly what will happen:** how many photos; that
  their sidecars, grades and virtual copies go too; and whether they go to
  the Recycle Bin or are **gone for good**. Network drives and many removable
  drives have no Recycle Bin, so the window must say so in that case.
  Default: Recycle Bin wherever one exists.
- Deleting a virtual copy is a different, smaller action (removes one grade,
  leaves the photo) and must be worded differently so the two are never
  confused.
- **Moving between drives** is really copy-then-delete. Check the copy
  succeeded before removing anything, show progress, and survive being
  interrupted without losing files.
- **Clashes and failures:** a file of the same name already at the
  destination, a file open in another program, a read-only location. Stop and
  ask; never overwrite silently. Report clearly which items were not done.
- The photo currently open in Grade: moving or renaming it must keep the
  session attached, or ask to close it first. Deleting it asks first.
- A folder that is being indexed, exported from, or having previews built:
  the operation waits or the job is cancelled cleanly.
- Undo where the system allows it (rename, move). Delete is undone from the
  Recycle Bin.
- For the future MCP server: an AI assistant can never delete from disk
  without a person confirming.

**Also included (decided by Steve, October 9):**

- Create a new folder.
- Move photos between folders by dragging (the sidecar travels).
- Rename a single photo (the sidecar is renamed with it).
- Delete all rejected: one command for everything marked reject in the
  current folder or album, behind the same "Are you sure?" window.
- Show in Explorer.

**Left out (decided by Steve, October 9):**

- Deleting a whole folder.
- Batch rename in the library. Any pattern naming belongs to **export**
  (naming the exported files), not to renaming originals.

## Background indexing

**Decided by Steve, October 9: pinned folders (and opened projects) are
indexed in the background, sub-folders included, on by default.** An advanced
setting lets people turn it off.

- Pinning a folder means "this is part of my library". Search, filters and
  smart albums cover everything under the pins.
- **Stay out of the way** (Steve): use processor capacity that is not busy; if
  anything needs the graphics card, do it only when the card is mostly idle.
  - Runs in the separate library helper process, at low priority, on a
    limited number of processor threads.
  - Slows or pauses while the user is grading, exporting or scrolling the
    library, and resumes when the app is quiet.
  - The basic pass needs no graphics card at all: file list, capture details,
    existing sidecars.
  - Heavier passes are separate and later in the queue: thumbnails (only when
    looked at, or optionally ahead of time), focus maps (only when that
    feature is on). Any that use the graphics card wait for it to be idle and
    always give way to the grade preview.
- Order of work: the folder on screen first, then recently used pins, then
  the rest.
- **Keeping up to date:** watch pinned folders for new, changed, moved and
  deleted files. Network drives often do not report changes reliably, so also
  re-check a folder when it is opened and offer a manual "re-scan".
- A drive that is unplugged keeps its index; its photos show as offline.
- **Visible but quiet:** a small progress indicator ("indexing 2026, 3,200 of
  18,000") with pause. Smart albums and searches say when indexing is still
  running, so a partial result is never mistaken for a complete one.
- Laptops: pause on battery by default. Idea only.
- Advanced settings: indexing on / off, how much processor to use, pause on
  battery, which pins to leave out.
- Measure on Steve's real photo drive early: time for the first full pass and
  database size.

## Sort and filter

Added by Steve mid-session.

- **Sort by:** capture time, file name, rating, pick status, file type, date
  modified, edited or not. Ascending or descending.
- **Filter by:** star rating (at least / exactly), pick / reject / unmarked,
  tags, colour label, edited / unedited, exported / not yet, file type (RAW,
  JPEG, HDR formats), camera, lens, ISO range, focal length, date range.
- **Text search** on file name and tags.
- Capture time and camera details have to be read from each file. On the first
  visit to a big folder the grid appears at once sorted by name, then settles
  into capture order as the details arrive. After that it is instant, from the
  database.
- Filters work inside the current folder or album first. Across pinned folders
  second.
- **Minimal UI:** one thin filter bar, hidden until called up, showing only
  active filters as small chips. Common filters on keys (for example "picks
  only", "3 stars and up").
- **RAW + JPEG pairs. Decided by Steve, October 9: two separate items**, each
  with its own rating and grade, plus a quick **RAW only** filter to hide the
  duplicates. No stacking of pairs.

## Smart albums

Requested by Steve, October 9.

- An album defined by **rules**, not by a hand-picked list. Example: tagged
  "kids" and "beach", and state is edited.
- **A smart album is a saved filter.** Same rules, same engine as the filter
  bar. Build a filter, press "Save as smart album". One system to build and
  to learn.
- Always current: a photo that starts matching appears, one that stops
  matching leaves. No manual upkeep.
- Covers **the photos the database has indexed**. That makes background
  indexing of pinned folders close to a requirement; otherwise a smart album
  silently misses folders never opened.
- Optional limit to chosen pinned folders ("only inside 2026").
- Rule building: match **all** or **any** of the rules, plus "is not". Keep
  nested groups for later unless needed.
- Rule fields: tags, rating, pick status, colour label, **state**, file type,
  camera, lens, focal length, aperture, ISO, shutter speed, capture date
  (including "last 30 days"), folder, is a virtual copy, sharpness score.
- **State needs a clear definition.** Proposed:
  - *Indexed, not edited:* known to the library, no grade adjustments saved.
  - *Edited:* has saved grade adjustments that differ from the defaults.
    Rating or tagging alone does not make a photo "edited".
  - *Exported:* has been exported at least once. Possibly also "edited since
    last export".
- Stored in the database as rules, not paths, so moving files does not break
  them. Worth being able to export and import the rule sets.
- Shown beside ordinary albums with a different small icon. Ordinary albums
  stay for hand-picked sets.

## Metadata

Requested by Steve, October 9: show all the camera and lens information that
can be reliably read, especially for RAW.

What exists today: the app already reads camera maker and model, lens and
lens maker, ISO, shutter speed, aperture and focal length when an image is
opened, and already matches camera and lens for lens corrections.

Needs investigating (a research task before design):

- **Standard fields are reliable** across brands: camera maker and model,
  capture date and time, ISO, shutter, aperture, focal length, exposure
  compensation, metering, flash, orientation, pixel size, GPS if present.
- **Lens identity is the unreliable part.** Many cameras do not write a plain
  lens name in the standard place. The real answer sits in each maker's
  private notes, in a different form for every brand, and often as a code
  number that has to be looked up. Adapted and manual lenses report nothing
  or something wrong.
- **Maker-specific extras** worth having when available: focus distance,
  focus mode and focus point, picture profile, stabilisation, drive mode,
  shutter type, serial numbers, shutter count, 35 mm-equivalent focal length,
  crop mode.
- Options for reading it:
  - The reader the app uses now. Already included, no new dependency, but
    limited on maker notes and lens look-up.
  - The RAW decoder's own reporting. Already included; gives some lens data.
  - ExifTool. The reference tool for this, by far the best lens and
    maker-note coverage. A separate program to bundle and license-check, and
    slower per file unless run in one long-lived batch.
- Generic, not built around one camera (Steve, October 9). Test on a sample
  from every brand the app supports. Record what is reliable per brand
  rather than promising everything everywhere.
- **Show the truth:** an unknown value is shown as unknown, never guessed.
  Where a lens is identified by look-up rather than read directly, that
  should be visible somewhere.
- Manual lens name override per photo or per selection, for adapted and
  vintage lenses. Saved in the sidecar; feeds filters and smart albums.
- Read once per file, in the background, stored in the database. This is the
  same pass that feeds sort, filter and smart albums.
- Display: a quiet info panel in the library. Short summary by default (camera,
  lens, focal length, aperture, shutter, ISO, date), "show all" for the full
  list. A one-line overlay under thumbnails as an option.
- Privacy on export (strip GPS, strip serial numbers) belongs with export
  settings. Note only.

## Culling tools

- Stars 0 to 5, pick / reject / unmarked, tags, maybe colour labels.
- Keyboard first: number keys for stars, single keys for pick and reject, arrow
  keys to move, optional auto-advance after marking.
- Works on a multi-selection.
- On screen: small marks on thumbnails only where something is set. Controls
  appear on hover or by key, not as permanent toolbars.

## Compare

- Pin a reference image. Arrow through candidates on the other side.
- **Zoom and pan stay locked together** so the same spot is checked on every
  candidate (the focus check in Steve's DxO screenshot).
- Side by side as the main mode. Split with a draggable divider as an option.
- Mark pick / reject / stars without leaving compare.
- Speed is the whole point. For RAW that favours the camera's embedded
  full-size JPEG for instant 100% views, then swapping in HDR Finisher's own
  rendering when ready. Trade-off: the instant view is the camera's look and
  SDR only.
- Later: compare more than two (survey view).

## Focus and sharpness overlay

Added by Steve mid-session. Reference: FastRawViewer's focus peaking, which
paints the sharp areas of a photo in a highlight colour.

- Goal: see where focus landed, and whether the photo is sharp at all, without
  zooming to 200%. Readable even at thumbnail size.
- A toggle (one key) that paints in-focus areas with a highlight colour, in the
  grid, single view and compare.
- **How it has to work:** a small thumbnail has already lost the fine detail
  that shows focus, so sharpness cannot be measured from the thumbnail. It is
  measured once from a large version (the camera's full-size embedded JPEG, or
  the RAW itself), saved as a small "focus map" in the cache, and then drawn
  over the thumbnail. After the first pass it costs nothing to show.
- FastRawViewer splits this into two overlays: strong edges and fine detail.
  Fine detail is the better sign of critical focus. Could offer one or both.
- **A sharpness score per photo** falls out of the same measurement. Uses:
  sort by sharpness, and mark the sharpest frame in a run of near-identical
  shots (like the brick and bee series in Steve's screenshot).
- Honest limits:
  - The score only means something between similar shots. A soft portrait and
    a brick wall cannot be ranked against each other.
  - High-ISO noise can look like detail and fool it. Needs a noise allowance.
  - The camera's embedded JPEG is already sharpened by the camera. Measuring
    from the RAW is more truthful but slower. Open question.
  - It shows where the sharp plane is, not whether it is on the right subject.
    A sharp background behind a soft eye still lights up.
- First pass over a folder takes time (reading a large preview per photo). Run
  it in the background, on-screen photos first, only when the overlay or the
  sharpness sort is switched on.
- Later idea: group near-duplicates automatically and suggest the sharpest.

## Layouts

- Grid (thumbnails only).
- Single image with a filmstrip.
- Compare.
- List with detail columns, maybe.
- Thumbnail size slider. Info overlay on / off.
- Each window remembers its layout.

## HDR / SDR preview modes

- One switch in the library: show as HDR or as SDR.
- Edited photos: show the HDR grade or the SDR grade the user made.
- Unedited photos: what "HDR" means before any grading needs defining
  (default rendering? or SDR until graded?).
- The library window uses the brightness limits of the monitor it is on.

## Batch work

- **Batch export** of a selection: each photo with its own grade, using a
  shared export preset (format, size, destination, naming).
- Export is the exact CPU path, which is slow per image. So: a background
  queue with progress, a time estimate, cancel, and a clear per-file result
  list. Must not block grading. Needs a memory plan for large files.
- **Copy and paste a grade** across a selection: see "Selective copy and
  paste of grades".
- Exact export stays under the "still strict" testing rule.

## Docked and popped out

- **Library** replaces **Import** in the main window.
- Docked: the library takes the preview area. Double-click (or Enter) opens the
  photo in Grade.
- Pop out: the library moves to its own window; the main window switches to
  Grade.
- Decided: single click selects and navigates only. Double-click or Enter
  opens the photo in Grade, docked or popped out. See the save model section.
- What the side panels show while the library is docked (photo details? quick
  export? nothing?) is open.
- The backend's staged open (quick preview first, full quality after) already
  exists and helps here.

## Claude's feedback (October 9)

Given when Steve asked for suggestions. **Steve agreed with all ten points on
October 9**, so treat them as direction: build in slices with culling first,
trial the two risky pieces early, run library work in a separate helper
process, keyboard-first minimal UI, focus overlay before any score, and start
after the modularization sprint. Colour labels, the list layout, the survey
view and the card-copy helper are parked unless Steve asks for them.

1. **This is a second product's worth of work.** The list now covers most of
   Lightroom's Library module. The risk is a long build with nothing usable
   until the end. Build in slices that are each useful alone, culling first:
   pinned folders, grid, ratings and picks, sort and filter, double-click to
   Grade. Steve could cull real shoots with that while the rest is built.
2. **The hard parts are not the ones that look hard.** The second window is
   easy. The two risky pieces are (a) keeping thumbnails of edited photos
   up to date at library scale, and (b) changing the save model under the
   existing project feature. Worth a small trial of each before committing to
   a design.
3. **Keep the library's background work away from grading.** Indexing folders,
   reading metadata, making thumbnails and measuring focus are all heavy. If
   they run inside the same backend process as the grade, Grade may stutter
   while a folder is being scanned. Suggest a separate helper process for
   library work from the start. Cheap early, awkward to retrofit.
4. **Minimal UI versus a long tool list is the real design problem.** Suggest
   keyboard first, controls that appear only when relevant, and one command
   search box for everything else. Also prune: colour labels, the list layout,
   the multi-photo survey view and the card-copy helper were Claude's
   additions, not Steve's requests. Cut them unless wanted.
5. **Batch changes need a safety net that outlasts undo.** Undo is gone after a
   restart. Suggest that any library command that rewrites grades (paste,
   preset, sync) first keeps each photo's previous grade in its sidecar as a
   "before" state that can be restored later.
6. **Browsing look versus opened look.** In an HDR tool, browsing the camera's
   SDR JPEGs and then seeing a different picture on opening will feel wrong
   more than it would in an SDR editor. Worth testing early whether a quick
   default rendering for on-screen thumbnails is affordable.
7. **Focus overlay first, sharpness score later.** The overlay is honest: it
   shows what it found and Steve judges. A score invites trusting a number
   that noise and subject matter can fool.
8. **Sidecars on synced or network folders** (OneDrive, NAS) can be written by
   two machines or mid-sync. Always write whole files in one step (the project
   save already does) and decide what happens on a conflict.
9. **Good news on testing.** Most of the library is new code beside the image
   pipeline, not inside it. It should rarely touch the "still strict" areas;
   batch export only calls the exact export, it does not change it.
10. **Timing.** The Codebase Modularization Sprint (started October 6) makes
    the interface easier to split into a mountable library piece. Finish that
    first.

## MCP server for HDR Finisher (separate item, before 1.0)

Raised by Steve, October 9. An MCP server lets an AI assistant operate the app
directly. It is its own piece of work and deserves its own PRD; noted here
because the library should be built ready for it.

- Likely first uses: relink missing sources, find photos ("kids at the beach,
  edited, 4 stars and up"), tag and rate in bulk, build albums and smart
  albums, apply a look preset to a set, queue a batch export, report what is
  in a project.
- The app already has the right shape: the interface talks to a local backend
  through commands. An MCP server would be a thin layer exposing chosen
  commands, not a second way of doing things.
- **What that asks of the library design now:**
  - Every library action is a backend command first and a button second. No
    logic that exists only in the interface.
  - Actions that change many photos keep the same guards for an AI as for a
    person: a count of what will change, the "before" state, one undo.
  - Plain, readable sidecar and project files.
  - Decide what an assistant may never do without a person confirming
    (deleting files, overwriting exports, writing outside pinned folders and
    projects).
- Open: read-only tools first and writing tools later? Does the app have to be
  open for the server to work?

## Gap check against other photo libraries (October 9)

Steve asked what major features other libraries have that are missing here.
Claude's list, from general knowledge of Lightroom, Capture One, DxO, Photo
Mechanic and FastRawViewer.

**Steve's decisions, October 9:**

- **In:** export recipes (1), exposure and clipping overlay (2), tag
  management (3), descriptive details / metadata authoring (4), full-screen
  review (7), undo for library actions (8).
- **Out:** stacks (5), working with other apps (6).
- **Unreadable files: hidden for now.** Some formats may be shown greyed out
  in the future.
- **Size target: yes, there must be one.** The number is not set yet. Set it
  after measuring how much each indexed photo weighs (database size, memory,
  speed), and expect to change it.
- **AI features** (search by content, automatic tagging): version 2 at the
  earliest.
- **Views** (including full screen) get designed properly later, with a
  wireframe or mock-up.
- Undo matters more because of multi-select: one slip can change many photos.
  It should cover ratings, picks, tags, album changes, moves and renames, and
  undo a multi-photo action as one step. Deletes are undone from the Recycle
  Bin.
- Not yet decided, from the smaller list: duplicate finding, watermark on
  export, edit history or snapshots.

Worth serious thought:

1. **Export recipes, several at once.** One export run that produces more
   than one deliverable, for example an HDR AVIF and an SDR JPEG, each with
   its own size, naming pattern and sub-folder. Capture One's strongest
   library feature and a natural fit for an HDR tool, where two versions are
   usually wanted. Includes naming patterns on export (Steve's stated home
   for batch naming) and a record of what was exported, so "edited since last
   export" can be filtered and re-exported.
2. **Exposure and clipping overlay.** The sibling of the focus overlay: show
   blown highlights and blocked shadows on thumbnails, read from the RAW
   data. For an HDR tool it could also show how much highlight range a photo
   really holds, which is what decides whether it is worth grading in HDR.
   Uses the same quick RAW decode.
3. **Tag management.** Tagging is in the notes but not the upkeep: suggestions
   while typing, a list of all tags with counts, renaming or merging a tag
   everywhere, and perhaps nested tags (family > kids). Without this, tags go
   stale fast and smart albums built on them stop working.
4. **Descriptive details for professional work.** Title, caption, creator,
   copyright and usage notes, entered once as a template and written into
   exported files. Expected for corporate delivery.
5. **Stacks for bursts and near-duplicates.** Group a run of similar shots
   under one thumbnail (by hand, or automatically by capture time), pick the
   keeper, collapse the rest. Pairs naturally with the focus overlay.
   Different from RAW + JPEG pairs, which Steve decided against stacking.
6. **Working with other apps.** "Open in..." to send a photo to another
   program, and keeping a file that came out of another program (for example
   a DNG processed elsewhere) linked to the RAW it came from.
7. **Full-screen review.** One key hides everything but the photo, on either
   monitor, with rating and pick keys still working. Cheap, and fits the
   minimal aim.
8. **Undo for library actions** generally (a rating, a tag, a move), not only
   for grade changes.

Smaller, easy to forget:

- What the library does with files it cannot open (videos, PSD, documents):
  hide them, or show them greyed out so a folder's contents are not a
  mystery.
- A stated size target, for example "stays quick with 100,000 indexed
  photos", so performance is designed for rather than hoped for.
- Finding duplicate files.
- Watermark on export.
- Edit history list or named snapshots inside one photo (the "before" state
  is a first step toward this).

Common elsewhere but deliberately not planned: faces, maps, AI search by
content ("dog on a beach") and automatic tagging, cloud sync, phone app,
tethering, printing, web galleries, slideshows, video. Note that AI search
and auto-tagging are becoming standard in other libraries; the MCP server is
a possible route to them without building them in.

## Not planned for now

Face recognition, maps, cloud sync, phone companion, tethered shooting, video,
stacks for bursts, "open in another app" and linking files processed
elsewhere, batch rename of originals, deleting whole folders. AI search and
automatic tagging: version 2 at the earliest.

## Open decisions for Steve

To be asked one at a time, each with its trade-off.

1. ~~Save model~~ **Decided:** autosave is a user option, on or off.
   **Decided:** with autosave off, a Save prompt appears only when
   double-click switches the photo in Grade. Browsing never prompts.
   **Decided:** library commands that change grades (paste, preset, sync)
   save straight away, keeping the previous grade as a "before" state.
   Follow-up: how many "before" states to keep, and what "revert to last
   saved" means when autosave is on.
2. ~~Sidecar location~~ **Decided:** next to each photo, hidden inside the
   library.
3. ~~Unedited RAW thumbnails~~ **Direction:** camera's embedded JPEG by
   default; HDR Finisher's own rendering arrives through "Create HDR
   previews".
4. ~~Grid in HDR~~ **Direction:** grid is SDR by default; HDR previews are
   made on request per folder, album or selection, kept in a user-limited
   cache cleared oldest-first in batches. **Decided:** also build
   screen-sized HDR previews, limited in resolution (proposed 2560 long edge).
   Grid comfort cap 1000 nits by default. After measuring speed, consider a
   plain HDR toggle instead of per-folder builds.
5. ~~Search scope~~ **Decided:** pinned folders are indexed in the
   background by default, with an advanced setting to turn it off.
6. ~~Ratings from other apps~~ **Decided:** ignored for now.
7. ~~Single or double click~~ **Decided:** single click navigates the
   library; double-click opens in Grade.
8. ~~RAW + JPEG pairs~~ **Decided:** two separate items, with a RAW only
   filter.
9. Projects: Steve leans to the sidecar replacing Save / Save As, with
   sharing through portable project folders (sources optional).
   **Decided:** a sidecars-only project offers merge or keep separate, with a
   simple manual relink. To confirm: whether album names are also written
   into sidecars.
10. Focus overlay: measure from the camera's embedded JPEG (fast) or from the
    RAW (more truthful, slower)?
11. Virtual copies: one sidecar holding all copies, or one file per copy?
12. Copy/paste of image-dependent settings: re-run on the target, or copy the
    numbers?
13. Look presets and film look: one "looks" menu or two?
14. Metadata reader: stay with what is built in, or bundle ExifTool for much
    better lens and maker-specific coverage?
15. Definition of "edited" for filters and smart albums.
16. Build order. Suggested first slice: docked folder grid with ratings,
    pick/reject, sort and filter. Then pop-out window. Then compare. Then
    batch export.

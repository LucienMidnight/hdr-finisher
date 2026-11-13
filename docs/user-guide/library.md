# Photo Library

The Library is where you browse, sort and organise your photos, and where you start grading. It opens when you launch the app.

The Library never changes your original photos. Everything you add to a photo (stars, labels, tags, albums and saved grades) is kept in a small `.hdrf` file beside it, so it travels with the photo.

## Add a folder

When you have no folders yet, the Library shows **Add a folder to start browsing.** Choose **Add a folder**. You can also choose the **+** next to **Folders** in the left panel.

1. Pick a folder in the list. Ctrl-click or Shift-click to pick several. Double-click a folder to look inside it.
2. Use **Up**, the path box and **Go** to move around. Switch between **List** and **Grid** to see photo previews.
3. Choose **Pin folder**. The window closes and the folder appears, selected, in the **Folders** list. You can also right-click a folder and choose **Pin folder to Library**.

A pinned folder stays in the **Folders** list and its photos are part of your Library. Photos stay where they are. Pinning a folder never moves or copies anything.

The **Locations** column on the left of the window holds your drives, standard folders such as Pictures, and your own shortcuts. To add a shortcut, right-click a folder and choose **Pin as a location**; right-click it again and choose **Remove from locations** to take it away. A location only makes browsing quicker: it does not add the folder to your Library. The same locations appear when you open an image or choose an export folder.

To stop showing a folder, right-click it and choose **Unpin folder**. Nothing is deleted from disk. Photos that are also in an album stay in the Library. If unpinning fails, your folder view and selection are restored.

Right-click a folder for more: **Check for new photos**, **New folder inside…**, **Rename label…**, **Rename folder…**, **Move folder…** and **Show in Explorer**.

The Library keeps pinned folders up to date in the background. If you copy new photos in, they appear shortly. You can also choose **Check for new photos** from the folder menu or the **…** (More) menu.

### Which files the Library shows

By default, the Library shows camera RAW files (including DNG), EXR, PFM, Radiance HDR, and 16-bit or floating-point TIFF. Right-click a photo, the empty grid, a sidebar folder or album, or the sidebar background and choose **Show all files** to include export formats. This choice is remembered across Library windows.

With **Show all files**, supported file types include: JPEG (`.jpg`, `.jpeg`), PNG, TIFF (`.tif`, `.tiff`), HEIC and HEIF, AVIF, JPEG XL (`.jxl`), OpenEXR (`.exr`), Radiance HDR (`.hdr`), PFM, DNG, and camera RAW files: Sony `.arw`, Canon `.cr2` and `.cr3`, Nikon `.nef` and `.nrw`, Fujifilm `.raf`, Panasonic `.rw2`, Olympus `.orf` and `.ori`, Pentax `.pef` and Samsung `.srw`.

It leaves out files that are not photos, even when they have a photo extension:

- Names that start with `.` or `~`, such as the `._` files macOS leaves on other drives and temporary files from other apps. A name that starts with `_`, like Sony's `_DSC0001.ARW`, is a normal photo.
- Files and folders that Windows marks as hidden or system.
- Folders for trash, snapshots and thumbnails, and any folder whose name starts with `.` or `~`. Named ones include `$RECYCLE.BIN`, `System Volume Information`, `#recycle`, `@Recycle`, `@eaDir`, `#snapshot` and `__MACOSX`.
- Files smaller than 1 KB.
- Links and shortcuts to other folders (symbolic links and junctions). They are not followed.

A file whose contents turn out not to be a picture (for example, a web page saved with a `.jpg` name) appears once under **Needs attention** as "Not a valid photo". It is not tried again until the file changes. A photo that is still being copied waits until the copy finishes.

**Online-only cloud files.** OneDrive, Dropbox, iCloud and Google Drive can keep a photo online and leave only a placeholder on your computer. The Library shows these as **Not downloaded** and never downloads them while you browse. Open one in Single or Grade to download it.

## Ways to look at your photos

The buttons at the top of the Library switch the view.

- **Grid** (G): a wall of thumbnails. Drag the **Thumbnail size** slider to make them larger or smaller.
- **Single photo** (Space): one large picture with a **Filmstrip** below. Press Space again to go back to the grid.
- **Full-screen review** (F): the picture fills the screen. Press F or Esc to leave.

Move between photos with the arrow keys. Click to select one photo. Shift-click selects a range, Ctrl-click adds or removes one, and dragging a box in the grid selects everything inside it. Ctrl+A selects all.

Pop the Library out into its own window with **Pop out Library** (the arrow icon at the top right). Use the same button to return it to the main window. Press Tab to hide or show both side panels, and I to hide or show **Details**.

### Zoom in

Choose **100%** (Z) in Single view to see the photo at full detail. Move the picture around to inspect any area. Press Z again to return to fit.

### Preview in HDR

Choose **HDR** (H) to see the Library pictures in HDR on an HDR display. Choose it again to go back to SDR. Unedited RAW camera pictures stay SDR even when HDR is enabled. The Filters panel still has a **RAW** select-all button.

### Compare two photos

Choose **Compare** (C) in Single view, or press C, to put two photos next to each other. Zoom and position are linked, so both show the same area.

- Press **[** to make the selected photo the one on the left.
- Use the arrow keys to move through the photos on the right.
- Press C again to leave Compare.

Open the **Compare** button to choose a **Layout** (**Side by side**, **Top and bottom** or **Split**) and to show or hide **File names and marks**. In **Split** layout, drag the divider, or use the left and right arrow keys on it.

### Check focus and exposure

Two overlays paint warnings on top of your pictures. They work in the grid, Single view and Compare.

- **Focus** (S) marks areas that look sharp. Open the **Focus** button to change **Strength**, **Sensitivity** and **Colour**.
- **Exposure** (E) marks **Clipped highlights** and **Near-black shadows**. Open the **Exposure** button to change **Strength**, switch either warning off, and pick their colours.

On an undeveloped RAW, Focus first checks the embedded camera JPEG so you can cull without waiting for RAW development. In Single, fullscreen and Compare, pausing for one second after that quick result starts a full-detail RAW check. Moving on cancels it; filmstrip tiles keep the quick result. An existing valid full-detail map can show directly.

The quick map reflects camera sharpening and JPEG detail. Use it as a guide, especially for borderline eyes; it is not an automatic sharpness verdict. A missing or very small embedded preview falls back to the slower RAW check.

Each button has an **Enabled** / **Disabled** switch. The overlays are based on the source photo, not on your grade.

They also work on RAW photos you have not developed. Exposure measures the RAW sensor data and lines it up with the camera preview. The quick Focus map already matches that preview; full-detail Focus uses RAW data and also needs alignment. If full detail cannot be aligned, the quick Focus map stays visible. An unalignable Exposure map shows **Exposure unavailable ? camera preview**; develop the photo to see it. Photos with a saved grade show **unavailable ? graded**.

## Rate and label photos

Select one photo or many. Everything below applies to all selected photos. Use the **Details** panel on the right, or the keyboard.

| What | Keys | Details panel |
|---|---|---|
| Star rating | 1 to 5; 0 clears | Stars and **0** |
| Pick | P | **Pick** |
| Reject | X | **Reject** |
| Remove pick or reject | U | **Clear** |
| Colour label | 6 red, 7 orange, 8 green, 9 blue | The four colour dots |
| Tag | T, then type | **Add tag…** box |

Press a colour key again to remove the label. You can give each colour a meaning in **Manage tags and labels…**. The meaning shows when you hover over the dot.

The Library confirms each change ("Rated 12 photos", for example) and offers **Undo**. Ctrl+Z undoes the last change too. Undo is forgotten when you close the app.

### Tags

Type a tag in **Add tag…** and press Enter. Suggestions appear as you type. Click the **×** next to a tag to remove it from the selected photos.

Choose **Manage tags and labels…** in **Details** to open **Tags and Labels**. There you can add, rename, merge and remove tags for the whole Library, and name your colour labels. A rename or merge changes every photo that carries the tag.

### Delete all rejected

Open the **…** (More) menu and choose **Delete all rejected…** to delete every rejected photo in the current folder or album. See [Rename, move and delete](#rename-move-and-delete-photos) below.

## Filter and sort

Choose **Filter** (Ctrl+F) to open the filter bar. It narrows what you see without changing any photo.

- Type in **File name or tag** to search.
- Choose a star rating, and choose **and up**, **exactly** or **and below**.
- Pick one or more of **Picked**, **Unmarked** and **Rejected**.
- Pick one or more colour labels, or **No label**.
- Choose **+ Filter** for more: file type, state (**Edited**, **Not edited**, **Exported**, **Edited since last export**), virtual copy, tag, camera, lens, ISO, focal length, aperture, shutter speed and capture date.

Ticks within one filter mean "any of these". Different filters must all match. Choose **Clear** to remove all filters.

Choose **Sort** to order photos by **Capture time**, **File name**, **Rating**, **Pick status**, **File type**, **State** or **Date modified**. The arrow button beside it switches between ascending and descending. The Library remembers the sort for each folder and album.

## Albums

An album gathers photos from any folder without moving them. A photo can be in many albums.

Choose the **+** next to **Albums** to make **New empty album…**, or **New album from selected photos…**. You can also right-click photos and choose **New album from this photo…**, **Add to** an album, or **Remove from** the open album.

Right-click an album to **Duplicate**, **Rename album…** or **Delete album…**. Deleting an album does not delete any photo. If it was open, the Library switches to an available pinned folder, or an empty Library when none is available.

A photo in an album stays in your Library even if its folder is not pinned.

## Smart albums

A smart album is a saved set of filter rules. It updates itself as photos change.

Opening an album shows its last known matches first, including after restarting the app. Thumbnails load separately while the album checks for changes in the background. A new album, or one whose rules or pinned folders have changed, needs a fresh check before its first grid appears.

1. Set up filters in the filter bar, then choose **Save as smart album…**. Or choose the **+** next to **Smart Albums** and **New smart album…**.
2. Give it a name. Choose **Match all of these rules** or **Match any of these rules**.
3. Under **Look in**, tick the pinned folders it should search.

The dialog shows how many photos match right now. Right-click a smart album to **Edit rules and name…**, **Save as manual album…** (a fixed copy of what matches now), **Duplicate** or **Delete smart album…**. Deleting a smart album only removes the rules.

## Open a photo in Grade

Double-click a photo, or select it and press Enter, to open it in **Grade**. Right-click and choose **Open in Grade** works too.

### How grades are saved

Your grade is saved in a `.hdrf` file next to the photo, for example `DSC02339.ARW.hdrf`. The photo itself is never changed. A file is only created when you first rate, tag or grade a photo. Browsing creates nothing.

- **Autosave** is on by default. The button at the top right shows **Autosave on** or **Autosave off**. With it on, your grade saves about a second after you stop editing, when you leave the photo and when you close the app.
- With autosave off, use **Save** (Ctrl+S). The app asks about unsaved changes before you leave a photo.
- Grade shows **All changes saved**, **Saving…** or **Unsaved changes** beside the photo name.
- If the app or Windows stops unexpectedly, the next start offers to restore your unsaved work. Choose **Restore unsaved work** or **Leave saved grade**. Nothing is applied without asking.

If the `.hdrf` file changes outside the app while you are working (for example a sync tool or another computer), the app pauses saving and asks **Grade changed elsewhere**. Nothing is overwritten. Choose:

- **Keep my grade** to keep what you have. The other grade is kept as the previous grade.
- **Use the file's grade** to take the file's version.
- **Keep both** to keep your grade and bring the file's grade in as a virtual copy.
- **Cancel** to keep working with saving paused.

### Revert a grade

Right-click a photo. The revert choices that apply are listed:

- **Restore previous grade…**
- **Revert to last saved…**
- **Revert to last session…**
- **Revert to original…**

Each one asks first. Marks and tags are not touched. Apart from **Revert to last saved…**, a revert keeps the old grade as the previous grade, so you can take it back.

## Virtual copies

A virtual copy is another grade of the same photo, for example a black and white version. No second image file is made. The copy is kept in the photo's `.hdrf` file.

Right-click a photo and choose **Create virtual copy…**. Choose to start from **The current grade** or **A clean start**, and optionally give it a name. Copies show a small copy icon in the grid. Each copy has its own grade, rating and tags.

To rename a copy, choose **Rename copy…**. To delete one, choose **Remove virtual copy…**. The photo and its other grades stay.

## Copy and paste a grade

1. Select one photo and press Ctrl+C (or choose **Copy grade**).
2. Select one or more photos and press Ctrl+V (or **Paste grade**).

Each photo keeps its previous grade, so Ctrl+Z undoes the paste.

To paste only some settings, press Ctrl+Shift+V or choose **Paste grade (choose settings)…**. Tick what you want. **All**, **Modified only** and **None** help you start. By default crop, lens corrections and local adjustments are not ticked.

The same commands are in the **Edit** menu.

## Rename, move and delete photos

Right-click a photo for **Rename photo…**, **Move to folder…** and **Delete…** (Delete key). The settings file and virtual copies always travel with the photo.

- **Rename photo…** keeps the file ending.
- **Move to folder…** asks if a file with the same name already exists: **Keep both**, **Skip this one** or **Cancel move**.
- **Delete…** explains what will happen before it does anything. Photos go to the Recycle Bin together with their settings. Restore both from the Recycle Bin to bring back the marks, grades and copies. If a drive has no Recycle Bin, the message says the photos will be gone for good, and the button reads **Delete permanently**.

After deleting the current photo, Single view selects the next remaining photo, or the previous one at the end. When none remain, the Library returns to an empty Grid. If only part of a deletion finishes, the status reports what was removed and whether settings still need attention; use **Activity** to review the unfinished work.

Folders have **Rename folder…** and **Move folder…** in their right-click menu.

These commands work on Windows only for now. On macOS and Linux the Library says they are not available yet and leaves your files untouched.

## Export from the Library

Select photos and choose **Quick export…** (Ctrl+Shift+E), in the right-click menu or the **Edit** menu. Quick export uses export presets you saved on the Export page. The batch runs in the background. Watch it in **Activity** at the bottom right, where you can pause or cancel it. Photos edited since their last export show in the **Edited since last export** filter.

**Open in Export** sends the selection to the Export page. See [Export and Delivery](export.md) for formats and presets.

## Activity

**Activity** at the bottom right shows what the Library is doing: saving settings, reading folders and running exports. It also shows **Needs attention** when something could not finish, with a **Try again** button. Marks are always kept safe in the Library until they are written.

You can pause saving or indexing, or choose **Re-scan pinned folders now**.

## Keyboard shortcuts

| Keys | What it does |
|---|---|
| G | Grid |
| Space | Switch between grid and Single view |
| F | Full-screen review |
| Esc | Leave full screen, or go back to the grid |
| Arrow keys | Move through photos |
| Enter | Open in Grade |
| Z | 100% zoom in Single view |
| H | HDR previews |
| C | Compare on or off |
| [ | Make the selected photo the left side of Compare |
| S / E | Focus / Exposure overlay |
| 0 to 5 | Star rating |
| P / X / U | Pick / Reject / Clear |
| 6 to 9 | Red / orange / green / blue label |
| T | Add a tag |
| Tab / I | Hide side panels / hide Details |
| Delete | Delete selected photos |
| Ctrl+F | Filter |
| Ctrl+A | Select all |
| Ctrl+C / Ctrl+V | Copy / paste grade |
| Ctrl+Shift+V | Paste grade, choosing settings |
| Ctrl+Shift+E | Quick export |
| Ctrl+Z | Undo the last Library change |

## Where everything is kept

- **Beside each photo:** the `.hdrf` file with that photo's grade, marks, tags, album names and virtual copies. This is the lasting record.
- **In the app's data folder:** the Library database (`library.sqlite3`), your pinned folder list, your colour label meanings, the picture cache and the logs. On Windows this is `%APPDATA%\hdr-finisher-desktop`.

The database is a fast index of the `.hdrf` files. It lets the Library show tag counts, albums and search results quickly.

### If the Library database is deleted

Close the app first. When you start it again, the Library rebuilds itself from the `.hdrf` files as folders are opened or scanned. Choose **Re-scan pinned folders now** in **Activity** to speed this up.

A few things live only in the database and can be lost:

- Marks or grades that had not yet been written to their `.hdrf` file.
- Unsaved work the app was keeping for recovery.
- Empty albums and unused tags, if the app's recovery list is also deleted.

Photos, saved grades and all marks already written beside photos are safe. The picture cache can be deleted at any time. It is made again when needed.

If you move a photo outside the app, move its `.hdrf` file with it. A photo without its file arrives with no marks.

## Not available yet

- Editing camera metadata (dates, captions and similar) from the Library.
- Renaming, moving and deleting photos on macOS and Linux.
- Linking photos so grades stay in step.
- Exporting a folder of photos and grades as one portable project.
- Looks you can apply to many photos from a Library menu.
- Undo history that survives closing the app.

## Related pages

- [Quick start](../getting-started/quick-start.md)
- [Export and Delivery](export.md)
- [Photo Library: how it works](https://github.com/LucienMidnight/hdr-finisher/blob/main/docs/technical/photo-library.md) (technical detail, on GitHub)

## When Grade is using the available memory

A very large photo can keep Grade's source in memory while you browse.
Small visible photos and quick previews can continue, but another large
photo may show **Waiting: memory in use by the photo open in Grade**.
Activity shows **Library paused: memory is in use by photo.dng in Grade**.

Open Activity and choose **Close photo in Grade** to resume that work.
The app finishes and saves your pending edits before closing the photo.
If saving fails, the photo stays open and the error is shown. You can keep
working in Grade while Library jobs wait.

**Waiting: not enough free memory on this computer** means other memory
use leaves too little room after the system reserve. Waiting is not a
failed photo; work resumes when enough memory is available.

### Unsupported photos, interrupted decoders and offline folders

Unedited RAWs show their embedded camera picture in the grid, filmstrip, Single, fullscreen and Compare when its long edge is at least 1024 pixels. They develop only for detail beyond that picture, or when you choose **Develop** from the right-click menu. Develop applies to the selection and never changes grades or sidecars.

When GPU development does not support a photo, the Library uses its CPU decoder. Development runs in the background helper and the finished picture is cached; if that decoder also cannot read the file, the photo shows an error while other pictures continue.

A quiet **Developed** label identifies HDR Finisher pictures, which remain while cached; after eviction, an unedited RAW returns to its camera picture.

Edited photos, photos without usable camera pictures, and mezzanine or HDR files develop only when shown. Plain SDR files are drawn directly. No neighbours or idle photos develop in the background.

Large mezzanine files decode one at a time, with the photo on screen taking priority. If a TIFF contains a small embedded preview, the Library enlarges it while preparing the sharp picture. A TIFF without an embedded preview cannot provide that stand-in.
The Library now explains these cases:

- “Not supported: JPEG XL source colour is unresolved. Open it in Grade to choose its source interpretation.”
- Fuji X-Trans photos use the camera picture under the same rules. When development is needed, they use the same decoder as Grade and may wait for memory or earlier work.
- When development is refused and a preview is available, the preview stays visible. Hover over the photo for the reason.
- “The photo decoder stopped while reading this file. The file was set aside; other photos continue.”
- “The photo decoder took too long. The file was set aside; other photos continue.”
- “This folder is offline. Reconnect the drive, then open the folder again.”

An offline read is not recorded as a broken photo. Affected pinned folders dim.
After reconnecting the drive, return to the Library window or reopen the folder
to retry. Hidden/minimised windows give foreground Library work priority; showing
the window restores its previous work classes. Very large pictures that require
the unfinished bounded route can still wait; that work is not complete.

In Settings > Appearance, **Developed badge** chooses **On hover** (the default,
also shown on keyboard focus) or **Always** for grid thumbnails. This application
preference is separate from projects and presets.

Move the pointer over the collections sidebar to reveal the larger + buttons beside Folders, Albums and Smart Albums. Keyboard focus also reveals them. Drag the matching grip beside a section or pinned folder to reorder it. Right-click a smart album and choose **Edit rules and name…** to change its saved filter.

## Opening a Smart Album

The Library shows its saved indexed matches immediately, then refreshes
them in the background. An empty saved result stays empty until refresh
finds matches. Refresh does not block the Library control and memory polls.

Fullscreen return restores the exact grid scroll position when the displayed photo
is unchanged. If you navigate to another photo in fullscreen, the grid returns
with that photo centered (as far as the first/last rows allow). Selected tiles
have a clear outline; the current photo also has an inner picture outline.

The shared status and shortcuts bar sits directly above the Library footer. It shows Ready when idle, export progress with Pause/Resume and Cancel icons during an export, and the finished file count afterwards. Activity keeps its detailed export controls and per-photo results; its button no longer repeats export progress.

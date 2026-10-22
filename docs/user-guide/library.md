# Photo Library

The Library is where you browse, sort and organise your photos, and where you start grading. It opens when you launch the app.

The Library never changes your original photos. Everything you add to a photo (stars, labels, tags, albums and saved grades) is kept in a small `.hdrf` file beside it, so it travels with the photo.

## Add a folder

When you have no folders yet, the Library shows **Add a folder to start browsing.** Choose **Add a folder**. You can also choose the **+** next to **Folders** in the left panel.

1. Pick a folder in the list. Ctrl-click or Shift-click to pick several. Double-click a folder to look inside it.
2. Use **Up**, the path box and **Go** to move around. Switch between **List** and **Grid** to see photo previews.
3. Choose **Pin folder**.

A pinned folder stays in the **Folders** list and its photos are part of your Library. Photos stay where they are. Pinning a folder never moves or copies anything.

To stop showing a folder, right-click it and choose **Unpin folder**. Nothing is deleted from disk. Photos that are also in an album stay in the Library.

Right-click a folder for more: **Check for new photos**, **New folder inside…**, **Rename label…**, **Rename folder…**, **Move folder…** and **Show in Explorer**.

The Library keeps pinned folders up to date in the background. If you copy new photos in, they appear shortly. You can also choose **Check for new photos** from the folder menu or the **…** (More) menu.

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

Choose **HDR** (H) to see the Library pictures in HDR on an HDR display. Choose it again to go back to SDR. Choose **RAW** to show only camera RAW files.

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

Each button has an **Enabled** / **Disabled** switch. The overlays are based on the source photo, not on your grade.

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

Right-click an album to **Duplicate**, **Rename album…** or **Delete album…**. Deleting an album does not delete any photo.

A photo in an album stays in your Library even if its folder is not pinned.

## Smart albums

A smart album is a saved set of filter rules. It updates itself as photos change.

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
- [Photo Library: how it works](../technical/photo-library.md) (technical detail)

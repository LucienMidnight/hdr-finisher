# Local Adjustments and Masks

A local adjustment changes part of your photo instead of all of it. It has two pieces: a **mask** that says where, and its own small grade that says what. Use one to brighten a face, darken a sky, or add contrast to a single wall.

Local adjustments live in **Grade > Local Adjustments**. They run after your global grade and its Detail, and before Film Look, Vignette and grain.

## How a local adjustment works

- The **mask** is shared. HDR and SDR use the same shape.
- The **grade** is separate. Inside **Local Adjustment Controls**, switch between the **HDR** and **SDR** tabs. Each tab keeps its own settings, so you can lift a shadow in HDR and leave it alone in SDR.
- **Match entire HDR grade** on the SDR side includes your local adjustments. See [SDR grading](grade-sdr.md).
- You can have many adjustments. They apply from the top of the list to the bottom.

The small circle beside the **Local Adjustments** heading switches the whole section on and off, so you can compare with and without every local change at once.

## Add a local adjustment

1. Open **Grade > Local Adjustments**.
2. Under **Mask Tools**, choose **Brush**, **Gradient**, **Luma** or **Path**.
3. Press **+** under the list. A new row appears in the **Adjustments** list.
4. Make the mask on the photo (see the sections below).
5. Set sliders under **Local Adjustment Controls**.

You can also press **+** first and pick the tool afterwards. The row reads **Pick a tool** until you choose. Once a row has a tool, that tool is fixed. To use a different kind of mask, press **+** again.

## Grade inside the mask

Each adjustment has its own grade. Everything here affects only the masked area.

- **Light · Local:** **Exposure**, **Highlights**, **Midtones**, **Shadows**, **Blacks**, **Contrast**.
- **Color · Local:** **Temperature**, **Tint**, **Saturation**, **Vibrance**.
- **Detail · Local:** **Texture**, **Clarity**, **Clarity Radius**, **Sharpen**, **Radius**, **Threshold**. Detail runs last inside the local grade.
- **Adjustment opacity** fades the whole adjustment in or out.

Curves and the colour wheels are global only. They are not in the local grade.

## Paint with the brush

Choose **Brush**, then drag over the photo to paint the mask.

Under **Brush Controls**, set how new strokes behave:

- **Size:** the width of the brush.
- **Feather:** how soft the edge of each stroke is.
- **Flow:** how quickly paint builds up as you go over the same spot.
- **Density:** the strongest the mask can get from a stroke.

To take paint away, press **Erase** and drag. Or hold **Alt** while you drag.

Under **Mask Controls**, these change all strokes together:

- **Opacity:** how strongly the whole mask applies.
- **Shift Edge:** grows or shrinks the painted area.
- **Feather:** softens the finished mask edge.

Use **Undo stroke** to remove the last stroke. **Clear brush** removes all strokes.

## Draw a gradient

Choose **Gradient**, then drag across the photo. The mask is full strength at the start point and fades to nothing at the end point.

Drag the end points to move or turn the gradient. Two smaller handles on the line shape the falloff: one sets where it starts to fade, the other where it is nearly gone.

Under **Gradient Controls**:

- **Fan** bends the end of the fade into a curve. Positive and negative values bow it in opposite directions.
- **Opacity** sets the overall strength.
- **Luminance range** (tick **Enable**) limits the gradient to certain brightness levels. Four handles set it in stops of scene exposure: **Dark fade**, **Dark full**, **Light full** and **Light fade**. Use it to keep a sky gradient off the shadows, or the other way round.

## Select by brightness

Choose **Luma** to mask by how bright the scene is. The mask follows the image, so it works on any shape.

- Click a **Quick range** button to pick a brightness band. The bands match the false-color colours.
- Click or drag on the photo to sample tones. The first sample replaces the starting range and later samples add to it. Hold **Alt** while sampling to remove tones.
- Under **Reference range**, drag the lower and upper edges to set the range by hand.
- Under **Refine range**, narrow the range further without changing the reference range. A short soft ramp is added on both sides, so the edge is gentle.
- **Feather** smooths the mask in space. **Opacity** sets its strength.

The range is based on the scene, not on your grade. Changing a local adjustment will never move the edge of a Luma mask.

## Draw a path

Choose **Path** to outline an area, such as a person or a building.

1. Click to add a corner. Drag as you click to add a smooth curve.
2. Click the first point, or press **Enter**, to close the shape. You need at least three points. Press **Escape** to cancel.
3. Use the **Path** and **Feather** buttons to choose which outline you are editing. The **Path** outline is full strength inside. The **Feather** outline is where the mask reaches zero. The mask fades smoothly between them.

To edit a closed path:

- Click on an outline to add a point.
- Drag a point or its handles to reshape it.
- Right-click a point, or press **Delete**, to remove it. A path keeps at least three points.
- Choose **Sharp** to make a corner. Choose **Smooth** for a flowing curve.
- Use the **Feather** slider to move the whole feather outline in or out. **Softness** smooths the fade. **Opacity** sets strength.
- **Reset feather shape** makes the feather outline an even distance from the path again.

Keyboard editing works when the photo is focused:

| Key | Action |
|---|---|
| **[** and **]** | Select the previous or next point |
| **H** | Cycle between the point and its two handles |
| Arrow keys | Move the selection (hold **Shift** for bigger steps) |
| **S** or **M** | Make the point sharp or smooth |
| **Enter** | Add a point after the selected one |
| **Delete** or **Backspace** | Remove the selected point |

## Combine masks

One adjustment can use several masks, for example "the sky, but not the mountains".

1. Select the adjustment.
2. Open its **More actions** menu (the three dots on its row) and choose **Create sub-mask**.
3. Pick a tool for the sub-mask and make it.
4. Open the sub-mask's own **More actions** menu and choose how it joins its parent:
   - **Union:** the area covered by either mask.
   - **Intersection:** only where both masks overlap.
   - **Subtract:** the parent mask, minus the sub-mask.

A sub-mask sits indented under its parent. It has its own bypass dot and settings. A sub-mask cannot have sub-masks of its own.

When a sub-mask is selected, the overlay shows three colours: **Parent** alone, **Child** alone, and **Overlap**. Select the parent row to see the final combined result.

Use **Invert mask** to swap covered and uncovered areas. The button then reads **Restore mask**.

## See the mask

- **Show overlay** paints the selected mask in colour over the photo. Press **Hide overlay** to remove it. Choose **Overlay color** if the default red is hard to see on your picture.
- **Hide gizmo** removes the handles and outlines from the photo so you can judge the result. **Show gizmo to edit** brings them back.

The overlay is only a guide. It is never exported.

## Rename, reorder, hide and delete

- **Rename:** double-click the name in the list, type a new one, and press **Enter**. Press **Escape** to cancel.
- **Reorder:** select an adjustment, then use the up and down arrow buttons below the list. Order matters when masks overlap.
- **Duplicate:** copies the selected adjustment with its mask and grades.
- **Hide:** click the dot on a row to bypass that adjustment. Click it again to bring it back. A hidden adjustment keeps its settings.
- **Delete:** select the adjustment and press **−**. You can undo it.

## Crop, rotate and masks

Masks belong to the photo, not to the frame. If you crop, rotate, straighten or flip, the masks stay on the same parts of the picture. You can change the crop after you have drawn a mask without redoing it. A mask drawn near the edge of the photo still works if you crop the edge out and later bring it back.

## Coming in 1.0

- **Hue selection** as a mask, so you can pick an area by colour.
- A **Retouch brush** with Inpaint, Heal and Clone.

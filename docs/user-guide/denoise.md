# Denoise

Denoise removes noise from a photo while keeping real texture. It measures how noisy your photo is, then cleans each area only as much as its noise needs. You do not choose a "noise profile" or enter an ISO.

Find it in **Grade**, in the **Denoise** group. It works the same way for camera RAWs, HDR files and renders.

## What it does

- It measures the noise in the file you opened. A noisy night shot, a clean low-ISO shot and a grainy render each get a different amount of cleaning at the same settings.
- It treats flat areas, such as sky and skin, more firmly than areas with edges or texture.
- It cleans brightness noise and colour noise separately, and at four sizes of noise, from single-pixel speckle to broad blotches.
- It runs before your other grading, so Exposure, Color and the rest work on the cleaned photo. It also runs in your export, so what you see is what you deliver.

## Turn it on

1. Open the **Denoise** group.
2. Click the round switch at the right of the group header. It lights up when Denoise is on.
3. Choose a **Method** and give it time to prepare. The Denoise header reads **Preparing**, then **Ready**. The current picture stays visible while it prepares, and you can keep adjusting the controls.

Click the switch again to compare. Turning Denoise off shows the original picture.

If you open another photo while Denoise is preparing or updating, the old work is discarded; it cannot change the new photo’s settings or status.

**Reset** in the group header and the **Default** preset select Clean Grain, restore Amount and Color Noise to 75%, and set Detail Recovery, Luminance and all four noise-size sliders to 50%. They restore Grain Evenness and Color Splotches to 100% and Splotch Size to Small. Saved grades and presets carry the method and its settings. Denoise starts off for new photos.

## Choose a method

- **Clean Grain** is selected for new photos. **Color Splotches** pulls coloured blotches toward the nearby colour. **Splotch Size** starts at Small. Choose Large for a wider reach. Color Splotches blends live after preparation and switches off at 0%.
- **Simple** uses the original Denoise. Saved grades with no recorded method keep using Simple.
- **Fine Grain · Experimental** evens out the remaining brightness grain. Use **Grain Evenness** to blend between Simple at 0% and the grain-matched 18-pixel setting at 100%.
- **Micro Grain · Experimental** cleans noise in Bayer RAW sensor data before the app builds the colour image. It aims to leave finer brightness grain. It has three controls, all starting at 50%:
  - **Luminance** reduces speckling in brightness.
  - **Color** reduces coloured specks and blotches.
  - **Detail** protects fine texture. Raise it if hair or fabric starts to look too smooth.

The Simple controls also work in Fine Grain and Clean Grain. Grain Evenness and Splotch Size can trigger preparation on release. **Even out harsh specks** at **×2.5** in Pixel cleanup is an independent RAW setting used in the comparison tests.

Micro Grain updates the visible area first when zoomed in, leaving the previous picture up while it works. At Fit it shows a quick preview before the more accurate picture. Micro Grain is for supported Bayer RAWs only. It isn't available with an authored SDR base, retouch repairs or Edge Colour highlight reconstruction.

For the Grain methods, look beside **Method** for **GPU**, **CPU backup**,
**Reduced preview**, **Preparing**, **Original**, **Off** or **Paused** (the
method cannot run on this photo or stopped with an error). The message below
explains the route,
including when lens correction sends Micro Grain to the CPU or a CPU preview
takes more than a couple of seconds. **Retry on GPU** is available for some
temporary failures. If Micro Grain is on the CPU and a retry is unavailable,
**Switch to Clean Grain** changes the method for the current grade. A reduced
preview leaves full-size export available.

Fine Grain and Clean Grain prepare the full photo when you enable the method
or change a setting that affects the preparation. You can then zoom and pan
using that result. The first preparation at Fit can take as long as at 100%.

Check bright edges, faces, lashes and fine dark hair at 100%. Clean Grain
reduces wide colour pulls around bright lights and still works on narrow
fringes. Some noisy colour marks can remain. Use **Show noise** to see what
was removed, lower Color Splotches, or compare with Fine Grain.

## Basic controls

- **Amount** sets how much cleaning is applied overall. It starts at 75%. At 50% you get the amount the app measured. Raise it for stubborn noise. At 0% nothing changes.
- **Detail Recovery** gives back fine detail that Denoise took out along with the noise. Raise it if textures such as hair, fabric or foliage look smooth. It starts at 50%.

Both sliders update the picture as you drag.

## Advanced controls

Click **Advanced** to show more.

- **Luminance** sets how much brightness noise is removed. It starts at 50%.
- **Color Noise** sets how much colour speckle is removed. It starts at 75%. Colour noise is usually easy to remove without losing detail, so this often tolerates a high setting.
- **Noise size** has four sliders. Each sets how strongly noise of that size is removed:
  - **Finest · 1–2 px:** pixel-level speckle.
  - **Fine · 2–4 px:** small grain.
  - **Medium · ~8 px:** soft blotches.
  - **Coarse · 16–32 px:** broad, cloudy patches, common in dark shadows of high-ISO raws.

On the size sliders, 50% is the measured amount and 0% leaves that size alone. **Luminance** and **Color Noise** still decide whether the removal applies to brightness or colour.

Start with **Amount**. Use the size sliders only when one kind of noise is left, for example cloudy colour patches in the shadows.

## Check what Denoise removes

Click **Show noise**. The picture turns grey and shows only what Denoise is taking away. The button then reads **Hide noise**, and a **Noise only · Denoise** badge appears over the picture.

- Even, grain-like speckle is what you want to see.
- Visible edges, lettering or outlines mean real detail is being removed. Lower **Amount** or raise **Detail Recovery**.

Grade preview and **Show noise** use WebGPU. Micro Grain uses the CPU for full-size Proof and export, and Show noise is unavailable in its CPU preview. Scopes keep showing your normal picture and update when you click **Hide noise**.

## Recalculate Denoise

The app measures your photo once, then reuses that measurement while you drag sliders. If the view changes after that measurement, the status shows **Dirty**. The last good result stays on screen until you click **Recalculate Denoise**.

Featureless blown-out highlights, such as a clipped flame or lamp, are ignored
when they cannot provide useful noise evidence. They no longer make Denoise
underestimate noise in nearby shadows. If too little useful evidence remains,
the app uses its usual fallback estimate; no extra control is needed.

The status line also shows **Recalculating**, or **Error** if the measurement failed. After an error the original picture is still available. Change a setting or click **Recalculate Denoise** to try again.

## HDR and SDR

HDR and generated SDR offer the same four Denoise methods. In Grade, the two renditions reuse Grain preparation when they use the same source pixels and preparation settings. An authored SDR base has its own preparation and cannot use Micro Grain because it has no sensor data.

Set Denoise separately for each rendition you want cleaned. **Match entire HDR grade** copies the HDR settings to SDR. While SDR is linked to HDR, it follows the HDR settings. An independent SDR grade keeps the copied settings as its starting point and can be adjusted separately.

## Where it fits in your workflow

1. Set **Exposure** first so the shadows are where you want them. Brightening shadows brings out noise.
2. Turn on **Denoise** and use **Show noise** to check it.
3. Then do **Detail**, **Black & White**, **Film Look** and local adjustments.

On noisy photos, run Denoise before **Black & White**. Colours in deep shadow are turned into grey, so cleaning the colour noise first keeps it from turning into brightness noise.

Denoise and **Detail** (including **Sharpen**) pull in opposite directions. Denoise smooths, and Sharpen brings out fine contrast, which includes any noise left over. Clean first, then sharpen a little. If you have to push Sharpen hard, check the result with **Show noise**.

**Film Look > Grain** adds grain on purpose, after Denoise. Denoise never removes film grain you add. If you want a grainy finish, you can denoise strongly and then add grain back.

## Limits

- Denoise cannot recover detail the noise has buried. Very high settings on a very noisy photo give a smooth, waxy look.
- It treats texture finer than the noise as noise. Fine patterns can soften at high **Amount** unless you raise **Detail Recovery**.
- It measures what is in the file. A file that was already denoised or heavily compressed elsewhere has little noise left to measure, so you will see little change.
- Large photos take longer to measure. While you drag a slider on a zoomed-in large photo, the app updates only the part you can see, and brings the rest up to date when you let go.
See also: [Grade HDR](grade-hdr.md) and the [Grading controls reference](grading-controls-reference.md).

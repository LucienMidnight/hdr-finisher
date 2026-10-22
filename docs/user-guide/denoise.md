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
3. Wait a moment. The status line under the controls reads **Preparing** while the app measures the noise, then **Ready**. You can keep working on the original while it prepares.

Click the switch again to compare. Turning Denoise off shows the original picture.

**Reset** in the group header puts the Denoise sliders back to their defaults.

## Basic controls

- **Amount** sets how much cleaning is applied overall. At 50% you get the amount the app measured. Raise it for stubborn noise. At 0% nothing changes.
- **Detail Recovery** gives back fine detail that Denoise took out along with the noise. Raise it if textures such as hair, fabric or foliage look smooth. It starts at 0%.

Both sliders update the picture as you drag.

## Advanced controls

Click **Advanced** to show more.

- **Luminance** sets how much brightness noise is removed.
- **Color Noise** sets how much colour speckle is removed. Colour noise is usually easy to remove without losing detail, so this often tolerates a high setting.
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

**Show noise** is available once Denoise is on and ready. It needs the GPU preview. Scopes keep showing your normal picture and update when you click **Hide noise**.

## Recalculate Denoise

The app measures your photo once, then reuses that measurement while you drag sliders. If the view changes after that measurement, the status shows **Dirty**. The last good result stays on screen until you click **Recalculate Denoise**.

The status line also shows **Recalculating**, or **Error** if the measurement failed. After an error the original picture is still available. Click **Recalculate Denoise** to try again.

## HDR and SDR

Denoise is separate for the HDR and SDR renditions. Set it on each one you want cleaned. When you use **Match entire HDR grade** for SDR, your HDR Denoise settings are copied across once. After that, the two stay independent.

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

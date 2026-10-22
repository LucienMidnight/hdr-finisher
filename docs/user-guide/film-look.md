# Film Look

Film Look makes a finished digital picture look as if it was shot on film and printed. It works in both the HDR and the SDR version, and it is the last creative step before export.

You do not need to know film to use it. Pick a Look or a stock, set **Look Strength**, and stop. The rest of the panel is there for when you want to go further. For exact slider ranges, see the [Grading Controls Reference](grading-controls-reference.md#film-look-in-hdr-and-sdr). For where Film Look sits in the grade, see [Grade HDR](grade-hdr.md#film-look).

## How Film Look works

The panel follows the path light takes through real film. Your picture is treated as the scene in front of the camera. It passes through five stages, in this order:

1. **Camera:** the film size, exposure and any lens filter.
2. **Negative:** the stock's colour and tone, halation, film resolution and grain.
3. **Development:** push or pull processing.
4. **Print:** the paper and the enlarger.
5. **Scan:** the scanner.

Each stage folds open and shut with its triangle. Next to the name it shows a short summary and a count of how many controls you have changed, for example **2 Mod**. Folding lasts only for the current session.

Film Look renders in real time on your graphics card, so you can watch the picture change as you drag. It sits after your local adjustments in the grade. Grain uses the same pattern in HDR and SDR, so the two versions match.

## Choose a stock

A stock is a film. It supplies colour, tone, grain, halation and a matching paper.

1. Open **Grade** and find **Film Look**.
2. Choose a **Film stock**.
3. Lower **Look Strength** if the effect is too much. At 0% the picture is unchanged. Your other values are kept, so you can bring the look back.

The card under the menu tells you what you picked: still or cinema film, how coarse the grain is, how strong the halation is, and which paper it prints on.

**Neutral** is the starting point. It applies a straight response with no stock colour, grain or halation, so you can use the controls without a stock behind them.

### Negative films

Colour negative films are printed to paper after they are developed.

- Kodak: Portra 160, Portra 400, Portra 800, Ektar 100, Gold 200, Ultramax 400, Verita 200D
- Kodak cinema: Vision3 50D, Vision3 200T, Vision3 250D, Vision3 500T
- Fujifilm: Pro 400H, C200, Superia X-Tra 400

### Slide films

Slides are scanned directly. There is no print, so the **Print** stage is locked while a slide is selected. Your Print settings are kept for the next time you choose a negative.

- Fujifilm Provia 100F
- Fujifilm Velvia 100
- Kodak Ektachrome 100
- Kodak Kodachrome 64

### Papers

Under **Print**, **Paper** offers three choices:

- **Stock's own paper:** the paper that suits the film you chose.
- **Kodak 2383:** the classic cinema print stock.
- **Fujifilm Crystal Archive Type II:** a common colour photo paper.

## Shape the print

The print is where much of a film's final look comes from. Open **Print** to change it.

- **Print Exposure** gives the paper more or less light. It makes the print darker or lighter, and it is separate from **Film Exposure**.
- **Print Warmth** and **Print Tint** act like enlarger filters. They move the colour toward yellow or blue, and toward magenta or green.
- **Preflash** lifts and softens the shadows.
- **Print Contrast** changes overall contrast. **Shadow Contrast** and **Highlight Contrast** change just the dark or bright end.

The row of shortcut buttons at the top of the stage sets only the controls in that stage. Use them as quick starting points.

Two stages sit either side of the print:

- **Development** has five buttons, from -2 to +2, to pull or push the film. Portra 800 +1 and +2 use measured push data. For every other stock, the buttons give an approximate change in film contrast.
- **Scan** has **Lab Levels (auto black and white)** and **Scan Sharpening**. Sharpening starts at 0, so nothing is added until you ask for it.

## Add grain and halation

Both are in the **Negative** stage.

**Halation** is the warm glow around bright lights. Light passes through the film, bounces off the back and exposes the film a second time. Turn it on, then set **Amount**. **Spread** sets how far the glow reaches, **Hue Offset** and **Saturation** tune its colour. Choose **Show halation map** to see where the glow can appear. The map shows placement, not strength, and it is not included in exports.

**Grain** is the texture of the film. Turn it on, then set **Amount**. **Size** sets how coarse it looks. **Softness** blurs it. **Chroma** adds colour to it. Under **Tone response**, **Shadows**, **Midtones** and **Highlights** let you keep grain strong in some tones and weaker in others. Choose **Show grain map** for a diagnostic view, also not exported.

**Film Format** (in **Camera**) changes how big the grain looks, because a small film frame is enlarged more. Choose from 65mm, 35mm, Super 35, Super 16, 16mm, Super 8 or Custom.

Fit view approximates the grain you will see at full size. Check at 100% before you decide on an amount.

**Film Resolution** softens fine detail the way a real negative does.

### How much to trust the numbers

Grain and halation values come from film data sheets where the manufacturer publishes them. Where the manufacturer publishes no data, values are estimates. The stock card marks these with "estimate". Treat them as a good starting point and judge by eye.

## Add a lens filter

Lens filters are in the **Camera** stage. They spread light before it reaches the film, the way a filter on the front of a lens does. They move light around rather than adding it.

Choose a **Lens Filter**:

- **None** turns the filter off.
- **Black Pro-Mist** is a light, gentle diffusion.
- **Pro-Mist** is a softer glow.
- **Glimmerglass** gives sparkle around highlights.
- **CineBloom** gives a heavy bloom.

**Strength** picks the grade of the filter, like the numbered filters sold for lenses. **Size** scales the glow. 1.00x is normal. Large glows on small film formats can look tighter than a real filter, because the widest edges are shortened.

## Stock-owned values and reset dots

Many controls take their starting value from the stock. Pick a different stock and those controls change with it.

When you change one of these controls yourself, a small reset dot appears before its name. The stage counts it as a **Mod**. Setting a control to the same value it already had also counts, because you chose it on purpose.

- Click the dot, or double-click the slider, to go back to the stock's value.
- Switching stock updates only the controls you have not touched.
- Your changes survive undo, redo and saving the project.

## Looks and stage presets

A **Look** is a complete Film Look recipe: a stock plus the changes that make it a style. Click **Preset** at the top of the Film Look panel to open **Adjustment Presets**.

Built-in Looks are listed under **Built-in**:

- Clean Cinema
- Soft Color Negative
- Dense Print
- High-Speed Texture
- Portra 400 Natural
- Night Tungsten
- Everyday Gold
- Lab Scan
- Velvia Landscape
- Kodachrome
- Super 8 Memories

Applying a Look replaces your current Film Look. Treat it as a starting point and change anything afterward.

Stage presets are the shortcut buttons inside **Camera**, **Print**, **Development** and **Scan**. They change only that stage, so you can mix a lens filter from one idea with a print from another.

## Save and reuse a look

1. Set up the look you want.
2. Click **Preset** in the Film Look panel.
3. Type a name under **Save current settings** and click **Save current**.

Your look appears under **Saved**. It records the stock, the paper and the controls you changed on purpose. It does not record values that came from the stock, so a saved look stays light and follows the stock.

Click **Reset** at the top of the panel to return Film Look to Neutral.

## Film Look in SDR

Film Look has the same controls in the HDR and SDR versions. You can set them separately.

In the SDR version, **Match HDR film look** copies the HDR look across once. After that, the two versions stay independent, so you can still adjust either one. If you use **Match entire HDR grade** on the SDR page, the Film Look comes with it.

The note at the bottom of the panel explains how the end result is handled:

- **HDR:** highlights above paper white keep their brightness ratios, so lamps and the sun stay bright.
- **SDR:** the print fits the screen's white.

There is nothing to set for either.

## Film Look with Black & White

If **Black & White** is on, Film Look adds no colour back. Halation is neutral, grain has no colour, and the print's colour response is off. Your Film Look values are kept, so turning Black & White off brings them back.

Later colour tools can still add colour on purpose, such as Color Grading wheels for split toning, RGB Curves and local adjustments. See [Grade HDR](grade-hdr.md).

## Credit

Film and paper data come from Andrea Volpato's [spektrafilm](https://github.com/andreavolpato/spektrafilm), licensed CC BY-SA 4.0. HDR Finisher runs its own engine. See `THIRD_PARTY_NOTICES.md` for the full notice.

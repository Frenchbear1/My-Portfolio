# David LaBarre — Personal Site

A static portfolio (`index.html`) with a separate résumé, site icons, photos,
fonts and aircraft renders under `assets/`. There is no build step.

Live site: https://frenchbear1.github.io/My-Portfolio/

The attached résumé is available from the site's download links as
`David-LaBarre-Resume.pdf`.

The Aviator Lab section launches David's seven interactive aviation tools in
an animated full-screen viewer without leaving the portfolio. Every tool also
includes an "Open in new tab" fallback.

On wider screens, the scrolling altitude display tops out at 12,500 feet and
surfaces compact, altitude-aware FAA and Part 91 quick-reference cues.

## Performance

The page is built to load quickly on slow phones and connections:

- `index.html` is ~45 KB. Photos live in `assets/photos/` as WebP in two sizes
  (480 px and full) and load lazily with `srcset`, so phones fetch the small ones.
- Fonts (Fraunces and Figtree, SIL Open Font License) are self-hosted variable
  WOFF2 files in `assets/fonts/`, so there is no third-party request before first paint.
- All scroll effects run in one `requestAnimationFrame` loop (`assets/site.js`)
  that stops when the page is still, and layout is measured once per resize.
  Idle motion (hero blob, aircraft bob) is pure CSS and pauses off-screen or in
  background tabs.
- Data Saver, 2G connections and low-memory devices get a lighter mode
  (no backdrop blur, smaller aircraft images, no prefetching).
- Motion respects `prefers-reduced-motion`.

## Aircraft background

The background progresses by section through David's aircraft sequence:

| Section | Aircraft |
| --- | --- |
| Introduction | Piper J-3 Cub |
| About | Diamond DA20-C1 |
| Flight log | Piper PA-28-181 Archer |
| Experience | Cessna 172S Skyhawk |
| Aviation tools | Extra 330LX |
| Photos | Piper PA-44-180 Seminole |
| Contact | Piper PA-28-181 Archer |
| Flight sim | Cessna 172S Skyhawk |

Each aircraft is a photoreal render of an original 3D model built to the type's
published dimensions (span, length, chord, dihedral, tail layout), with paint
inspired by the supplied photos. Logos and registration numbers are omitted.
They are decorative illustrations, not engineering models. Renders are
transparent WebP files in `assets/aircraft/` (`*-1600.webp` for large and retina
screens, `*-800.webp` otherwise, ~35–125 KB each). Only the aircraft on screen is
downloaded, and the next one is fetched when the browser is idle. Propellers
are rendered with motion blur, the way they look in flight photos.

Reference material used for proportions and configurations:
- [Smithsonian J-3 Cub](https://airandspace.si.edu/collection-objects/piper-j-3-cub/nasm_A19771128000)
- [Diamond DA20-C1 brochure](https://www.diamondaircraft.com/fileadmin/diamondaircraft/documents/da20/Brochure_DA20-C1_2022_DIGITAL.pdf)
- [Piper Archer LX](https://www.piper.com/model/archer-lx/)
- [Cessna Skyhawk](https://cessna.txtav.com/en/piston/cessna-skyhawk)
- [Extra 330LX](https://extraaircraft.com/330lx/)
- [Piper Seminole](https://www.piper.com/model/seminole/)

## Deploy with GitHub Pages (free)

1. **Create a repo.** On github.com, click "New repository." Name it anything
   — for a URL like `yourname.github.io/anything`, any name works. If you
   want your site at `yourname.github.io` exactly, name the repo
   `yourname.github.io` (replace `yourname` with your GitHub username).
2. **Upload the site.** Include `index.html`, the whole `assets/` folder
   (photos, fonts, aircraft, icons, scripts), `site.webmanifest`, and
   `David-LaBarre-Resume.pdf`, then commit.
3. **Turn on Pages.** Go to the repo's Settings tab → Pages (left sidebar).
   Under "Build and deployment," set Source to "Deploy from a branch," Branch
   to `main` and folder to `/ (root)`, then Save.
4. **Wait ~1 minute**, then refresh that Pages settings page — it'll show
   your live URL, something like:
   - `https://yourname.github.io/repo-name/` (normal repo name), or
   - `https://yourname.github.io/` (if you named the repo `yourname.github.io`)

That's it — no build step, no dependencies to install.

## Using your own domain (optional)

If you buy a domain (Namecheap, Google Domains, etc.):

1. In the repo, Settings → Pages → "Custom domain," enter your domain, save.
   This creates a `CNAME` file in the repo automatically.
2. At your domain registrar, add a DNS record pointing to GitHub Pages:
   - For an apex domain (`davidlabarre.com`): four `A` records pointing to
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - For a subdomain (`www.davidlabarre.com`): a `CNAME` record pointing to
     `yourname.github.io`
3. DNS can take a few hours to propagate. Once it does, check "Enforce HTTPS"
   back in the Pages settings.

## Making changes later

Edit `index.html` for page content, `assets/site.js` for interactions, and the
files in `assets/` for photos, aircraft and icons, then commit the changed files.
To add a photo, save it as WebP in `assets/photos/` at 480 px wide and at full
size (e.g. `name-480.webp` and `name-1000.webp`), then copy an existing gallery
`<button class="ph">` entry and update its file names, size and alt text.

## Fly the Skyhawk (flight sim)

The last section launches `sim/`, a hand-flown Cessna 172S simulator, in a full-screen
overlay. Nothing from it loads until **Take off** is pressed; closing it returns to the
same scroll position and unloads the sim.

- **Setup popup**: type any US airport ICAO/FAA identifier (live FAA AIS data), pick a
  runway, start on the runway or in the air on downwind, and choose time of day, clouds,
  wind, map layer (satellite, VFR sectional, topo) and, on touch screens, joystick or tilt.
- **World**: CesiumJS (from jsDelivr, no ion key), AWS Terrain Tiles elevation, USGS
  imagery and topo, FAA sectional/TAC charts, NASA GIBS city lights at night.
- **Flight model** (`sim/js/fdm.js`): six-degree-of-freedom rigid body using published-range
  172 stability derivatives, a stall break (clean stall about 48 KIAS), post-stall
  autorotation so an uncoordinated stall drops a wing and spins, left-turning tendencies,
  flaps, trim, and spring/damper landing gear with brakes and nose-wheel steering.
- **Weight & balance**: 172S POH stations (front seats 37.0, rear 73.0, baggage 95.0/123.0,
  fuel 48.0 in), normal and utility envelopes and an editable empty weight. Weight changes
  mass, inertia, stall and lift-off speeds, ground roll and climb; CG changes pitch stability
  and stick feel (aft CG spins faster and recovers slower). Fuel burns off in flight and a dry
  tank stops the engine.
- **Auto-trim** (on by default): trims out held elevator, holds the attitude and bank where you
  let go and centres the ball, but stays out of the way near the stall or with rudder in.
- **Phone cockpit** (`sim/pad.html`): scan the QR code in setup and the phone becomes a 172S
  panel (split master, avionics buses, light switches, key, throttle, mixture, fuel selector
  and shutoff, trim wheel, flaps, pedals with toe brakes, parking brake) with tach and fuel
  gauges, tilted like a yoke. It links straight to the computer over WebRTC using the free
  PeerJS broker, so no server is needed.
- **Clouds**: volumetric (ray-marched 3D noise with sun scattering, self-shadowing, flat bases,
  sunset colour); you can fly into them. Lighter settings on phones.
- **Engine start**: choose a cold start, then hold I (or the key button, or the phone's key
  at START): the propeller visibly turns over on the starter and catches.
- **Map**: tap the map for layer, north-up/track-up, range, circle/square and size, and to drop
  the airplane anywhere at a chosen heading, altitude and speed.
- **Landscape lock**: on phones the cockpit stays landscape even if the browser flips to portrait
  (or the iPhone's portrait lock is on); tilt keeps using the landscape axes.
- **Controls**: arrows pitch/roll, A/D rudder, W/S throttle, F/V flaps, Q/E trim, Space brakes,
  C camera (chase, cockpit, fly-by), M map, N time, P pause, I (hold) start engine. Phones and iPads get an
  on-screen joystick (or device tilt), rudder pedals, throttle, trim and brake, with the
  rest as icons.

The 3D model is generated in the browser, adapted from
[3D-Flight-Sim](https://github.com/Frenchbear1/3D-Flight-Sim). Representative behaviour
for fun, not training.

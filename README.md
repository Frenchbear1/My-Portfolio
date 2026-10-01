# David LaBarre — Personal Site

A static portfolio (`index.html`) with embedded photos, a separate résumé,
site icons, and lightweight aircraft animation files under `assets/`.
There is no build step. Google Fonts loads the page's two font families.

Live site: https://frenchbear1.github.io/david-labarre-site/

The attached résumé is available from the site's download links as
`David-LaBarre-Resume.pdf`.

The Aviator Lab section launches David's seven interactive aviation tools in
an animated full-screen viewer without leaving the portfolio. Every tool also
includes an "Open in new tab" fallback.

On wider screens, the scrolling altitude display tops out at 12,500 feet and
surfaces compact, altitude-aware FAA and Part 91 quick-reference cues.

## Aircraft background

The background progresses by section through David's aircraft sequence:

| Section | Aircraft |
| --- | --- |
| Introduction | Yellow Piper J-3 Cub |
| About | Diamond DA-20 |
| Flight log | Piper PA-28-181 |
| Experience | Cessna 172S |
| Aviation tools | Extra 330 |
| Photos | Piper PA-44 Seminole |
| Contact | Piper PA-28-181 |

`assets/aircraft.js` builds original, stylized vector aircraft with paint colors
from the supplied reference photos. Logos and registration numbers are omitted.
These are decorative illustrations, not engineering models. Wings, tails,
canopies, struts, fixed gear, and the Seminole's twin nacelles distinguish them.
The Seminole appears in flight with its retractable gear stowed.

`assets/aircraft.css` controls the crossfades and a deliberately slow, decorative
4.8-second propeller revolution. The twin propellers counter-rotate. Rotors pause
when hidden or when the tab is in the background, and respect reduced motion.
Aircraft positions are set before they become visible to prevent a loading flash.
Section anchors adapt to changes in page height, including gallery filters.

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
2. **Upload the site.** Include `index.html`, the `assets/` folder,
   `site.webmanifest`, and `David-LaBarre-Resume.pdf`, then commit.
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

Edit `index.html` for page content and the files in `assets/` for aircraft and
icons, then commit the changed files to the repository.

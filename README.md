# David LaBarre — Personal Site

A single self-contained page (`index.html`) — all photos, fonts, and code are
baked into that one file, so there's nothing else to configure.

Live site: https://frenchbear1.github.io/david-labarre-site/

The attached résumé is available from the site's download links as
`David-LaBarre-Resume.pdf`.

The Aviator Lab section launches David's seven interactive aviation tools in
an animated full-screen viewer without leaving the portfolio. Every tool also
includes an "Open in new tab" fallback.

On wider screens, the scrolling altitude display tops out at 12,500 feet and
surfaces compact, altitude-aware FAA and Part 91 quick-reference cues.

## Deploy with GitHub Pages (free)

1. **Create a repo.** On github.com, click "New repository." Name it anything
   — for a URL like `yourname.github.io/anything`, any name works. If you
   want your site at `yourname.github.io` exactly, name the repo
   `yourname.github.io` (replace `yourname` with your GitHub username).
2. **Upload the file.** In the new repo, click "Add file" → "Upload files,"
   drag in `index.html` from this folder, and commit.
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

Edit `index.html` directly (it's plain HTML/CSS/JS, readable in any text
editor) and re-upload it to the repo, or come back here and ask me to update
it — I can hand you a fresh copy anytime.

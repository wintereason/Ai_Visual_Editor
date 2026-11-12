# Mobile apps

## What "Mobile" means here
The spec decides (section 6, W02) that **Mobile = a phone-sized app, built as an installable web app (a PWA)**, not a native iOS/Android binary. That is what is built.

Pick the project type when you start a project (New... > Project type) or later (top bar > Project):
- **Website**: as before.
- **Mobile app**: the canvas is one phone screen. Starter apps (School app, Coaching app), and Elements > **App screens** (screen header, bottom tab bar with 2 to 5 tabs, tappable list rows). On a computer the published app shows as a phone-width column.
- **Website + app**: a responsive website that is also installable.

## What an exported or published app contains
For Mobile and Website + app projects, on top of the normal site files:
- `manifest.webmanifest`: name, short name, colours, how it opens (standalone / minimal / browser), and two icons.
- `icons/icon-192.png`, `icons/icon-512.png`: drawn for you from the **app icon** you pick in Project settings, else your **brand logo**, else the first letter of the app name on your colour. The logo is kept inside the middle 64% so phones that crop icons into circles don't cut it.
- `sw.js`: a small offline worker. After the first visit the pages open with no connection (pages: network first, falling back to the saved copy; everything else: saved copy first). Switch it off in Project settings. It never handles other websites or anything but GET.
- Page tags (`theme-color`, Apple touch icon, ...) and extra security-policy lines (`manifest-src 'self'`, `worker-src 'self'`, `connect-src 'self'`). The one inline script that registers the worker is allowed by its fingerprint, as with the other platform scripts.

Installing: open the published site on a phone, then the browser menu > **Add to Home screen** / **Install app**. Chrome on Android offers it once the icons and manifest are valid; Safari on iPhone uses Share > Add to Home Screen.

## Limits (honest)
- **Not an App Store / Play Store app.** There is no native binary, no push notifications, no access to phone hardware beyond what a website can use, and iOS web apps have their own limits (for example storage can be cleared if the app isn't used for a while).
- **Putting it in a store is a separate, manual step** that is not built or tested here: wrap the published site with a tool such as PWABuilder (Android/Windows packages) or Capacitor (Android/iOS projects), and use a developer account (Google Play: one-time fee; Apple: yearly fee). Apple may reject apps that are only a thin web wrapper, so expect to add genuinely app-like value.
- A mobile-only project is edited at one size (the phone), and the `mobile` breakpoint styles are not used for it; its published page shows as a phone-width column on desktops.
- Offline use covers pages and pictures that were saved; a contact form still needs a connection to send. If a site has very many pictures (more than ~15 MB), they are saved as they are visited rather than all at once.
- Checked automatically: manifest and icons are valid and published, the worker installs, activates, and serves pages offline (a test hosts the exported app, lets a real browser install it, goes offline and navigates). Not checked: how a given phone's home screen displays the icon, or store submissions.

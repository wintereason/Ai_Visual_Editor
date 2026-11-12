import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Node, Project } from "@avc/schema";
import { nodeCss, safeCssUrl, themeCss, type AssetUrl } from "./css";
import { ANIM_CSS, ANIM_SCRIPT } from "./anim";
import { formIdFor, formScript, type FormsConfig } from "./forms";
import { ChartEl, GRAPHICS_CSS, IconEl, MiniIcon, ShapeEl, TableEl } from "./graphics";

export const CF_BEACON = "https://static.cloudflareinsights.com/beacon.min.js";
import { effectiveTrigger } from "@avc/schema";

/** The path of the page being rendered ("/", "/classes"), so a tab bar can show which tab you are on. */
const PathCtx = React.createContext<string>("");
const samePath = (a: string, b: string) => {
  const n = (x: string) => { const p = x.split(/[?#]/)[0]!.replace(/\/+$/, ""); return p === "" ? "/" : p; };
  return a.startsWith("/") && n(a) === n(b);
};

const cls = (id: string) => "n-" + id.replace(/[^a-zA-Z0-9_-]/g, "_");
const p = (n: Node) => n.props as Record<string, any>;

const ASPECTS = new Set(["1 / 1", "4 / 3", "3 / 2", "16 / 9", "3 / 4", "2 / 3", "9 / 16"]);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? +v.toFixed(3) : d);
/** Where a layer sits in its group: percentages, validated numbers only. */
export function placeStyle(pl: Node["place"]): React.CSSProperties {
  const r = num(pl?.r, 0);
  return { left: `${num(pl?.x, 10)}%`, top: `${num(pl?.y, 10)}%`, width: `${num(pl?.w, 40)}%`, ...(r ? { transform: `rotate(${r}deg)` } : {}) };
}

const BASE_CSS =
  // border-box everywhere, so a width of 50% means 50% even with padding and borders (the model users expect)
  `*,*::before,*::after{box-sizing:border-box}` +
  `.avc-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.avc-form-status{margin:0;min-height:1.2em}.avc-form-status[data-state=error]{color:#b91c1c}` +
  `.avc-nav{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;gap:16px}` +
  `.avc-nav a{color:inherit;text-decoration:none}` +
  `.avc-nav span{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px}` +
  `.avc-fg h2{margin:0;padding:32px 24px 0}` +
  `.avc-hero{padding:64px 24px;display:flex;flex-direction:column;gap:16px}` +
  `.avc-hero-split{flex-direction:row;align-items:center}` +
  `.avc-btn{display:inline-block;padding:10px 20px;border-radius:8px;background:var(--c-primary);color:#fff;text-decoration:none}` +
  `.avc-btn-outline{background:transparent;border:2px solid var(--c-primary);color:var(--c-primary)}` +
  `.avc-btn-ghost{background:transparent;color:var(--c-primary)}` +
  `.avc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;padding:24px 24px 48px}` +
  `.avc-card{background:var(--c-surface);padding:24px;border-radius:12px}` +
  `.avc-hero-img{max-width:100%;max-height:420px;border-radius:12px;object-fit:cover}` +
  `.avc-hero-split .avc-hero-img{flex:1 1 0;min-width:0}` +
  `.avc-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;padding:24px 24px 48px}` +
  `.avc-stats{text-align:center}.avc-stat{display:flex;flex-direction:column;gap:4px}.avc-stat strong{font-size:2.25rem;line-height:1.1;color:var(--c-primary)}.avc-stat span{color:var(--c-muted)}` +
  `.avc-stats-cards .avc-stat{background:var(--c-surface);padding:24px;border-radius:12px}` +
  `.avc-steps{list-style:none;margin:0;padding:24px 24px 48px;display:grid;gap:24px}` +
  `.avc-steps-horizontal{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}.avc-steps li{display:flex;gap:12px;align-items:flex-start}` +
  `.avc-steps h3{margin:0 0 4px}.avc-steps p{margin:0;color:var(--c-muted)}` +
  `.avc-step-n{flex:none;width:36px;height:36px;border-radius:50%;background:var(--c-primary);color:#fff;display:grid;place-items:center;font-weight:700}` +
  `.avc-faq-list{padding:24px 24px 48px;display:grid;gap:8px;max-width:820px}` +
  `.avc-faq details{background:var(--c-surface);border-radius:8px;padding:12px 16px}.avc-faq summary{cursor:pointer;font-weight:600}.avc-faq details p{margin:8px 0 0;color:var(--c-muted)}` +
  `.avc-plans{align-items:stretch}.avc-plan{background:var(--c-surface);border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:12px}` +
  `.avc-plan h3{margin:0}.avc-price{margin:0}.avc-price strong{font-size:2rem}.avc-price span{color:var(--c-muted)}` +
  `.avc-plan ul{margin:0;padding-left:18px;flex:1}.avc-plan-hl{outline:2px solid var(--c-primary);background:var(--c-background);box-shadow:0 8px 24px rgba(0,0,0,.12)}` +
  `.avc-member{margin:0;display:flex;flex-direction:column;gap:12px}.avc-member img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px}` +
  `.avc-avatar{display:grid;place-items:center;background:var(--c-primary);color:#fff;font-size:2rem;font-weight:700;width:88px;height:88px;aspect-ratio:auto;border-radius:50%}` +
  `.avc-member figcaption{display:flex;flex-direction:column;gap:2px}.avc-member figcaption span{color:var(--c-muted)}.avc-member figcaption p{margin:6px 0 0}` +
  `.avc-team-plain .avc-member img,.avc-team-plain .avc-avatar{width:96px;border-radius:50%}` +
  `.avc-logos-title{text-align:center;color:var(--c-muted);margin:0;padding:32px 24px 0}.avc-logos{list-style:none;margin:0;padding:24px;display:flex;flex-wrap:wrap;gap:24px 40px;justify-content:center;align-items:center}` +
  `.avc-logos img{max-height:40px;width:auto}.avc-logos span{font-weight:700;color:var(--c-muted);font-size:1.25rem}` +
  `.avc-cta{padding:64px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px}.avc-cta h2,.avc-cta p{margin:0}` +
  `.avc-cta-primary{background:var(--c-primary);color:#fff}.avc-cta-surface{background:var(--c-surface)}` +
  `.avc-cta-primary .avc-btn{background:#fff;color:var(--c-primary)}` +
  `.avc-gallery figure{margin:0}.avc-gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;display:block}` +
  `.avc-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px;padding:32px 24px}.avc-footer p{margin:0}.avc-footer-links{display:flex;flex-wrap:wrap;gap:8px 20px}.avc-footer a{color:inherit}` +
  `img,video{max-width:100%}` +
  // an image with a set shape is cropped to fill it ("cover", the default) or shown whole ("contain"), never stretched
  `:where(img){object-fit:cover}.avc-contain{object-fit:contain}` +
  `@media (max-width:1024px){.avc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}` +
  `@media (max-width:640px){.avc-grid{grid-template-columns:1fr}.avc-hero-split{flex-direction:column}.avc-nav{flex-wrap:wrap}}` +
  GRAPHICS_CSS +
  // app-style blocks (platform "mobile"): screen header, bottom tab bar, tappable list rows. Touch targets are at least 44px.
  `.avc-ah{display:flex;align-items:center;gap:12px;padding:14px 16px;min-height:56px}.avc-ah-t{flex:1;min-width:0}.avc-ah h1{margin:0;font-size:1.25rem;line-height:1.2}.avc-ah p{margin:2px 0 0;color:var(--c-muted);font-size:.875rem}` +
  `.avc-ah-back,.avc-ah-act{color:inherit;text-decoration:none;min-width:44px;min-height:44px;display:inline-grid;place-items:center}.avc-ah-act{color:var(--c-primary);font-weight:600}` +
  `.avc-ah-colored{background:var(--c-primary);color:#fff}.avc-ah-colored p,.avc-ah-colored .avc-ah-act{color:#fff}.avc-ah-colored p{opacity:.85}` +
  `.avc-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;background:var(--c-background);border-top:1px solid color-mix(in srgb,var(--c-text) 14%,transparent);padding:4px 4px calc(4px + env(safe-area-inset-bottom))}` +
  `.avc-tab{flex:1;min-width:0;min-height:48px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:11px;color:var(--c-muted);text-decoration:none;padding:2px}.avc-tab span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.avc-tab-on{color:var(--c-primary);font-weight:600}` +
  `body:has(.avc-tabbar){padding-bottom:calc(64px + env(safe-area-inset-bottom))}` +
  `.avc-al h2{margin:0;padding:16px 16px 8px;font-size:1rem;color:var(--c-muted);font-weight:600}.avc-al-list{list-style:none;margin:0;padding:0}` +
  `.avc-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 16px;color:inherit;text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--c-text) 10%,transparent)}` +
  `.avc-row-ic{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--c-primary) 12%,transparent);color:var(--c-primary)}` +
  `.avc-row-t{flex:1;min-width:0}.avc-row-t strong{display:block}.avc-row-t span{display:block;color:var(--c-muted);font-size:.875rem}` +
  `.avc-row-b{flex:none;font-size:.75rem;padding:2px 8px;border-radius:999px;background:var(--c-primary);color:#fff}.avc-row-go{flex:none;color:var(--c-muted)}` +
  `.avc-al-inset .avc-al-list{margin:0 16px;background:var(--c-surface);border-radius:16px;overflow:hidden}.avc-al-inset .avc-row:last-child,.avc-al-plain .avc-row:last-child{border-bottom:0}` +
  // a mobile-only project shows as a phone-width column even on a big screen
  `body.avc-app{max-width:480px;margin-left:auto;margin-right:auto;min-height:100vh;box-shadow:0 0 0 1px color-mix(in srgb,var(--c-text) 12%,transparent)}` +
  `html:has(body.avc-app){background:color-mix(in srgb,var(--c-text) 7%,var(--c-background))}body.avc-app{background:var(--c-background)}.avc-app .avc-tabbar{max-width:480px;margin:0 auto}` +
  // the phone-width rules, applied by the column's width (a phone's window is already narrow; a desktop's is not)
  `.avc-app .avc-grid{grid-template-columns:1fr}.avc-app .avc-hero-split{flex-direction:column}.avc-app .avc-nav{flex-wrap:wrap}` +
  // layer groups: a fixed-shape box; each layer is placed by percentage, so the whole composition scales together
  `.avc-lg{position:relative;width:100%;overflow:hidden}:where(.avc-lg){margin-left:auto;margin-right:auto}` +
  `.avc-lp{position:absolute;transform-origin:center}` +
  // A layer's width always comes from its placement (so it is not overridable by the element's own width). Everything else here is a zero-specificity default, so anything the person sets (hidden, spacing...) wins.
  `.avc-lp>*{width:100%;margin:0;box-sizing:border-box}:where(.avc-lp)>:where(img,svg){display:block;height:auto}` +
  ANIM_CSS;

/** One span per word, each with its position as --i so CSS can stagger them. */
function words(text: unknown) {
  return String(text ?? "").split(/\s+/).filter(Boolean).map((w, i) => (
    <React.Fragment key={i}>
      <span className="avc-w" style={{ ["--i" as string]: i }}>{w}</span>{" "}
    </React.Fragment>
  ));
}

/** CSS for an image's non-destructive edits. Values are numbers validated by the schema; non-finite numbers are ignored. */
export function imageEditStyle(pr: Record<string, any>): React.CSSProperties | undefined {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const pct = (v: number) => +(v / 100).toFixed(2);
  const a = (pr.adjust ?? {}) as Record<string, unknown>;
  const f: string[] = [];
  if (num(a.brightness) !== undefined) f.push(`brightness(${pct(a.brightness as number)})`);
  if (num(a.contrast) !== undefined) f.push(`contrast(${pct(a.contrast as number)})`);
  if (num(a.saturation) !== undefined) f.push(`saturate(${pct(a.saturation as number)})`);
  if (num(a.grayscale) !== undefined) f.push(`grayscale(${pct(a.grayscale as number)})`);
  if (num(a.blur) !== undefined) f.push(`blur(${a.blur}px)`);
  const style: React.CSSProperties = {};
  if (f.length) style.filter = f.join(" ");
  if (pr.mask === "circle") Object.assign(style, { borderRadius: "50%", aspectRatio: "1 / 1", objectFit: "cover" });
  else if (pr.mask === "rounded") style.borderRadius = 16;
  return Object.keys(style).length ? style : undefined;
}

function Body({ n, css, assetUrl, animate, editing, forms }: { n: Node; css: string[]; assetUrl?: AssetUrl; animate: boolean; editing?: boolean; forms?: boolean }): React.ReactElement | null {
  const c = cls(n.id);
  const curPath = React.useContext(PathCtx);
  css.push(nodeCss(c, n.styles, assetUrl));
  const imgSrc = (assetId: unknown, fallback: unknown): string | undefined => {
    const u = typeof assetId === "string" ? assetUrl?.(assetId) : undefined;
    const chosen = u ?? (typeof fallback === "string" ? fallback : undefined);
    return chosen && safeCssUrl(chosen) !== null ? chosen : undefined;
  };
  const a = animate ? n.animation : undefined; // theme motion "off" disables every animation
  const anim: Record<string, unknown> = a
    ? { "data-anim": a.preset, "data-trigger": effectiveTrigger(a), style: { ["--d" as string]: `${a.durationMs ?? 600}ms`, ["--dl" as string]: `${a.delayMs ?? 0}ms` } }
    : {};
  const kids = n.children?.map((k) => <Body key={k.id} n={k} css={css} assetUrl={assetUrl} animate={animate} editing={editing} forms={forms} />);
  const pr = p(n);
  // In the editor canvas, continuous motion is switched off so text and boxes hold still while being edited.
  const still = editing && a && (a.preset === "marquee" || a.preset === "parallax") ? " avc-still" : "";
  const common = { className: c + still, "data-node": n.id, ...anim } as any;
  const withC = (extra: string) => ({ ...common, className: `${extra} ${c}` });

  switch (n.type) {
    case "section": return <section {...common}>{kids}</section>;
    case "container": return <div {...common}>{kids}</div>;
    case "layerGroup": {
      const ratio = ASPECTS.has(pr.aspect) ? pr.aspect : "16 / 9";
      const labelled = typeof pr.label === "string" && pr.label.trim() ? { role: "img", "aria-label": pr.label } : {};
      return (
        <div {...common} {...labelled} className={`avc-lg ${common.className}`} style={{ ...(common.style ?? {}), aspectRatio: ratio }}>
          {n.children?.map((k) => (
            <div key={k.id} className="avc-lp" data-layer={k.id} style={placeStyle(k.place)}>
              <Body n={k} css={css} assetUrl={assetUrl} animate={animate} editing={editing} forms={forms} />
            </div>
          ))}
        </div>
      );
    }
    case "heading": return React.createElement(`h${pr.level ?? 2}`, common, a?.preset === "word-by-word" ? words(pr.text) : pr.text);
    case "text": return <p {...common}>{a?.preset === "word-by-word" ? words(pr.text) : pr.text}</p>;
    case "button": return <a {...withC(`avc-btn${n.variant && n.variant !== "solid" ? ` avc-btn-${n.variant}` : ""}`)} href={pr.href ?? "#"}>{pr.label}</a>;
    case "image": return <img {...common} className={`${common.className}${pr.fit === "contain" ? " avc-contain" : ""}`} style={{ ...(common.style ?? {}), ...(imageEditStyle(pr) ?? {}) }} src={imgSrc(pr.assetId, pr.src)} alt={pr.alt} />;
    case "video": return <video {...common} src={imgSrc(pr.assetId, pr.src)} poster={pr.poster} controls autoPlay={pr.autoplay} muted={pr.autoplay} />;
    case "icon": return <IconEl name={pr.name} common={common} />;
    case "shape": return <ShapeEl shape={pr.shape} label={pr.label} common={common} />;
    case "chart": return <ChartEl chartType={pr.chartType} title={pr.title} data={pr.data} common={common} />;
    case "table": return <TableEl columns={pr.columns} rows={pr.rows} caption={pr.caption} common={common} />;
    case "divider": return <hr {...common} />;
    case "spacer": return <div {...common} aria-hidden="true" />;
    case "link": return <a {...common} href={pr.href}>{pr.text}</a>;
    case "input": return <label {...common}>{pr.label}<input name={pr.name} type={pr.inputType} required={pr.required} /></label>;
    case "list": return React.createElement(pr.ordered ? "ol" : "ul", common, (pr.items as string[]).map((t, i) => <li key={i}>{t}</li>));
    case "embed": return <iframe {...common} src={pr.url} sandbox="allow-scripts allow-same-origin" loading="lazy" title={pr.provider} />;
    case "navbar":
      return (
        <nav {...withC("avc-nav")}>
          <strong>{pr.brand}</strong>
          <span>
            {(pr.links as any[]).map((l, i) => <a key={i} href={l.href}>{l.label}</a>)}
            {pr.ctaLabel && <a className="avc-btn" href={pr.ctaHref ?? "#"}>{pr.ctaLabel}</a>}
          </span>
        </nav>
      );
    case "hero":
      return (
        <div {...withC(`avc-hero${n.variant === "split" ? " avc-hero-split" : ""}`)}>
          <div>
            <h1>{pr.headline}</h1>
            {pr.subheadline && <p>{pr.subheadline}</p>}
            {pr.ctaLabel && <a className="avc-btn" href={pr.ctaHref ?? "#"}>{pr.ctaLabel}</a>}
          </div>
          {imgSrc(pr.imageAssetId, undefined) && <img className="avc-hero-img" src={imgSrc(pr.imageAssetId, undefined)} alt="" />}
        </div>
      );
    case "featureGrid":
      return (
        <div {...withC("avc-fg")}>
          {pr.title && <h2>{pr.title}</h2>}
          <div className="avc-grid">
            {(pr.items as any[]).map((it, i) => <div key={i} className={n.variant === "plain" ? "" : "avc-card"}><h3>{it.title}</h3><p>{it.body}</p></div>)}
          </div>
        </div>
      );
    case "stats":
      return (
        <div {...withC("avc-fg")}>
          {pr.title && <h2>{pr.title}</h2>}
          <div className={`avc-cols avc-stats${n.variant === "cards" ? " avc-stats-cards" : ""}`}>
            {(pr.items as any[]).map((it, i) => <div key={i} className="avc-stat"><strong>{it.value}</strong><span>{it.label}</span></div>)}
          </div>
        </div>
      );
    case "steps":
      return (
        <div {...withC("avc-fg")}>
          {pr.title && <h2>{pr.title}</h2>}
          <ol className={`avc-steps avc-steps-${n.variant ?? "horizontal"}`}>
            {(pr.items as any[]).map((it, i) => <li key={i}><span className="avc-step-n" aria-hidden="true">{i + 1}</span><div><h3>{it.title}</h3><p>{it.body}</p></div></li>)}
          </ol>
        </div>
      );
    case "appHeader":
      return (
        <header {...withC(`avc-ah avc-ah-${n.variant ?? "plain"}`)}>
          {pr.backHref && <a className="avc-ah-back" href={pr.backHref} aria-label="Back">←</a>}
          <div className="avc-ah-t"><h1>{pr.title}</h1>{pr.subtitle && <p>{pr.subtitle}</p>}</div>
          {pr.actionLabel && <a className="avc-ah-act" href={pr.actionHref ?? "#"}>{pr.actionLabel}</a>}
        </header>
      );
    case "tabBar":
      return (
        <nav {...withC("avc-tabbar")} aria-label="Main">
          {(pr.items as any[]).map((it, i) => {
            const on = samePath(String(it.href ?? ""), curPath);
            return <a key={i} className={`avc-tab${on ? " avc-tab-on" : ""}`} href={it.href} aria-current={on ? "page" : undefined}><MiniIcon name={it.icon} /><span>{it.label}</span></a>;
          })}
        </nav>
      );
    case "appList":
      return (
        <div {...withC(`avc-al avc-al-${n.variant ?? "inset"}`)}>
          {pr.title && <h2>{pr.title}</h2>}
          <ul className="avc-al-list">
            {(pr.items as any[]).map((it, i) => {
              const inner = (
                <>
                  {it.icon && <span className="avc-row-ic"><MiniIcon name={it.icon} size={22} /></span>}
                  <span className="avc-row-t"><strong>{it.title}</strong>{it.subtitle && <span>{it.subtitle}</span>}</span>
                  {it.badge && <span className="avc-row-b">{it.badge}</span>}
                  {it.href && <span className="avc-row-go" aria-hidden="true">›</span>}
                </>
              );
              return <li key={i}>{it.href ? <a className="avc-row" href={it.href}>{inner}</a> : <div className="avc-row">{inner}</div>}</li>;
            })}
          </ul>
        </div>
      );
    case "faq":
      return (
        <div {...withC("avc-fg avc-faq")}>
          {pr.title && <h2>{pr.title}</h2>}
          <div className="avc-faq-list">
            {(pr.items as any[]).map((it, i) => <details key={i} open={editing || undefined}><summary>{it.question}</summary><p>{it.answer}</p></details>)}
          </div>
        </div>
      );
    case "pricing":
      return (
        <div {...withC("avc-fg")}>
          {pr.title && <h2>{pr.title}</h2>}
          <div className="avc-cols avc-plans">
            {(pr.plans as any[]).map((pl, i) => (
              <div key={i} className={`avc-plan${pl.highlighted ? " avc-plan-hl" : ""}`}>
                <h3>{pl.name}</h3>
                <p className="avc-price"><strong>{pl.price}</strong>{pl.period ? <span> / {pl.period}</span> : null}</p>
                <ul>{(pl.features as string[]).map((f, j) => <li key={j}>{f}</li>)}</ul>
                {pl.ctaLabel && <a className="avc-btn" href={pl.ctaHref ?? "#"}>{pl.ctaLabel}</a>}
              </div>
            ))}
          </div>
        </div>
      );
    case "team":
      return (
        <div {...withC("avc-fg")}>
          {pr.title && <h2>{pr.title}</h2>}
          <div className={`avc-cols avc-team${n.variant === "plain" ? " avc-team-plain" : ""}`}>
            {(pr.members as any[]).map((m, i) => {
              const src = imgSrc(m.imageAssetId, undefined);
              return (
                <figure key={i} className="avc-member">
                  {src ? <img src={src} alt={m.name} /> : <div className="avc-avatar" aria-hidden="true">{String(m.name).trim().charAt(0).toUpperCase()}</div>}
                  <figcaption><strong>{m.name}</strong>{m.role ? <span>{m.role}</span> : null}{m.bio ? <p>{m.bio}</p> : null}</figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      );
    case "logoStrip":
      return (
        <div {...withC("avc-fg")}>
          {pr.title && <p className="avc-logos-title">{pr.title}</p>}
          <ul className="avc-logos">
            {(pr.logos as any[]).map((l, i) => {
              const src = imgSrc(l.imageAssetId, undefined);
              return <li key={i}>{src ? <img src={src} alt={l.name} /> : <span>{l.name}</span>}</li>;
            })}
          </ul>
        </div>
      );
    case "ctaBanner":
      return (
        <div {...withC(`avc-cta avc-cta-${n.variant ?? "primary"}`)}>
          <h2>{pr.headline}</h2>
          {pr.subheadline && <p>{pr.subheadline}</p>}
          <a className="avc-btn avc-btn-light" href={pr.ctaHref ?? "#"}>{pr.ctaLabel}</a>
        </div>
      );
    case "gallery":
      return (
        <div {...withC("avc-fg")}>
          {pr.title && <h2>{pr.title}</h2>}
          <div className="avc-cols avc-gallery">
            {(pr.images as any[]).map((im, i) => {
              const src = imgSrc(im.assetId, im.src);
              return src ? <figure key={i}><img src={src} alt={im.alt} loading="lazy" /></figure> : null;
            })}
          </div>
        </div>
      );
    case "testimonial": return <figure {...common}><blockquote>{pr.quote}</blockquote><figcaption>{pr.author}{pr.role ? `, ${pr.role}` : ""}</figcaption></figure>;
    case "contactForm":
      return (
        <form {...common} {...(forms ? { "data-avc-form": formIdFor(n.id) } : {})}>
          {pr.title && <h2>{pr.title}</h2>}
          <input name="name" placeholder="Name" aria-label="Name" /><input name="email" type="email" placeholder="Email" aria-label="Email" required={forms || undefined} />
          <textarea name="message" aria-label="Message" required={forms || undefined} />
          {forms && <input className="avc-hp" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />}
          <button type="submit">{pr.submitLabel}</button>
          {forms && <p className="avc-form-status" role="status" aria-live="polite" data-avc-status="" />}
        </form>
      );
    case "footer": return <footer {...withC("avc-footer")}><p>{pr.copyright}</p>{(pr.links as any[]).length > 0 && <nav className="avc-footer-links" aria-label="Footer">{(pr.links as any[]).map((l, i) => <a key={i} href={l.href}>{l.label}</a>)}</nav>}</footer>;
    default: return null;
  }
}

export type RenderedPage = { html: string; css: string };

export type RenderOptions = {
  assetUrl?: AssetUrl;
  /** Editor canvas only: expands collapsible content (FAQ answers) so it can be seen and edited. */
  editing?: boolean;
  /** Published sites only: turns contact forms into live forms that post to this endpoint. */
  forms?: FormsConfig;
  /** Published sites only: Cloudflare Web Analytics site token (32 hex characters). Adds the cookie-less analytics beacon. */
  analyticsToken?: string;
  /** Extra <head> markup. Trusted: only the publisher passes it (SEO tags, CSP); never build it from user input unescaped. */
  head?: string;
};

export function renderPage(project: Project, pageId: string, opts: RenderOptions = {}): RenderedPage {
  const page = project.pages.find((x) => x.id === pageId);
  if (!page) throw new Error(`page "${pageId}" not found`);
  const css: string[] = [];
  const html = renderToStaticMarkup(<PathCtx.Provider value={page.path}><main>{page.nodes.map((n) => <Body key={n.id} n={n} css={css} assetUrl={opts.assetUrl} animate={project.theme.motion !== "off"} editing={opts.editing} forms={!!opts.forms} />)}</main></PathCtx.Provider>);
  return { html, css: themeCss(project.theme) + BASE_CSS + css.join("") };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export function renderDocument(project: Project, pageId: string, opts: RenderOptions = {}): string {
  const { html, css } = renderPage(project, pageId, opts);
  const page = project.pages.find((x) => x.id === pageId)!;
  const app = project.platform !== "web";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1${app ? ",viewport-fit=cover" : ""}"><title>${esc(page.seo?.title ?? page.name)}</title>${opts.head ?? ""}<style>${css}</style></head><body${project.platform === "mobile" ? ` class="avc-app"` : ""}>${html}${html.includes(`data-trigger="scroll"`) ? `<script>${ANIM_SCRIPT}</script>` : ""}${opts.analyticsToken && /^[a-f0-9]{32}$/.test(opts.analyticsToken) ? `<script defer src="${CF_BEACON}" data-cf-beacon='{"token": "${opts.analyticsToken}"}'></script>` : ""}${opts.forms && html.includes(`data-avc-form`) ? `<script>${formScript(opts.forms)}</script>` : ""}</body></html>`;
}

/** Output file for a page path: "/" -> index.html, "/a/b" -> a/b/index.html */
export function pageFile(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return clean ? `${clean}/index.html` : "index.html";
}

/** Static site: one standalone HTML document per page, keyed by output file path. */
export function renderSite(project: Project, opts: RenderOptions = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const page of project.pages) out[pageFile(page.path)] = renderDocument(project, page.id, opts);
  return out;
}

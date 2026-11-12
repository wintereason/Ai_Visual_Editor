// Animation runtime for published pages. Everything here is static text owned by the platform;
// no user or AI content is ever interpolated into the script (spec 15.1).

const ENTRANCE: Record<string, string> = {
  "fade-in": "from{opacity:0}to{opacity:1}",
  "slide-up": "from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}",
  "slide-down": "from{opacity:0;transform:translateY(-24px)}to{opacity:1;transform:none}",
  "slide-left": "from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}",
  "slide-right": "from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}",
  "zoom-in": "from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}",
  "rotate-in": "from{opacity:0;transform:rotate(-6deg) scale(.96)}to{opacity:1;transform:none}",
  "blur-in": "from{opacity:0;filter:blur(8px)}to{opacity:1;filter:none}",
  reveal: "from{opacity:0;clip-path:inset(0 100% 0 0)}to{opacity:1;clip-path:inset(0 0 0 0)}",
};

const keyframes = Object.entries(ENTRANCE).map(([p, body]) => `@keyframes avc-${p}{${body}}`).join("");

// Entrance presets: "load" plays immediately; "scroll" waits for the element to enter the viewport.
// Hiding before reveal only happens when the runtime script has set .avc-js, so a page without JS stays fully visible.
const entrance = Object.keys(ENTRANCE)
  .map(
    (p) =>
      `[data-trigger="load"][data-anim="${p}"]{animation-name:avc-${p}}` +
      `.avc-js [data-trigger="scroll"][data-anim="${p}"]:not(.avc-in){opacity:0}` +
      `.avc-js [data-trigger="scroll"][data-anim="${p}"].avc-in{animation-name:avc-${p}}` +
      // used by the editor's "Play" button
      `[data-anim="${p}"].avc-play{animation-name:avc-${p}!important}`,
  )
  .join("");

// Text effects. typewriter grows the element's width; word-by-word staggers per-word spans emitted by the renderer.
const textFx =
  `@keyframes avc-type{from{max-width:0}to{max-width:100%}}` +
  `@keyframes avc-caret{50%{border-color:transparent}}` +
  `[data-anim="typewriter"]{display:inline-block;max-width:100%;overflow:hidden;white-space:nowrap;vertical-align:bottom;border-right:2px solid currentColor}` +
  `[data-trigger="load"][data-anim="typewriter"],.avc-js [data-trigger="scroll"][data-anim="typewriter"].avc-in,[data-anim="typewriter"].avc-play{animation-name:avc-type,avc-caret;animation-timing-function:steps(30,end),step-end;animation-iteration-count:1,infinite;animation-duration:var(--d,600ms),.8s}` +
  `.avc-js [data-trigger="scroll"][data-anim="typewriter"]:not(.avc-in){max-width:0}` +
  `[data-anim="word-by-word"] .avc-w{display:inline-block}` +
  `[data-trigger="load"][data-anim="word-by-word"] .avc-w,.avc-js [data-trigger="scroll"][data-anim="word-by-word"].avc-in .avc-w,[data-anim="word-by-word"].avc-play .avc-w{animation:avc-slide-up var(--d,600ms) ease-out both;animation-delay:calc(var(--dl,0ms) + var(--i,0) * 90ms)}` +
  `.avc-js [data-trigger="scroll"][data-anim="word-by-word"]:not(.avc-in) .avc-w{opacity:0}`;

const hover =
  `[data-anim^="hover-"]{transition:transform .25s ease,box-shadow .25s ease}` +
  `[data-anim="hover-lift"]:hover{transform:translateY(-6px);box-shadow:0 12px 28px rgba(0,0,0,.18)}` +
  `[data-anim="hover-scale"]:hover{transform:scale(1.05)}` +
  `[data-anim="hover-glow"]:hover{box-shadow:0 0 24px var(--c-primary)}` +
  `[data-anim="hover-tilt"]:hover{transform:perspective(600px) rotateX(4deg) rotateY(-6deg)}`;

const attention =
  `@keyframes avc-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}` +
  `[data-anim="shimmer"]{color:transparent;background:linear-gradient(90deg,var(--c-text) 35%,var(--c-primary) 50%,var(--c-text) 65%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;animation:avc-shimmer calc(var(--d,600ms)*4) linear infinite}` +
  `@keyframes avc-float{from{transform:translateY(0)}to{transform:translateY(-10px)}}` +
  `@keyframes avc-pulse{from{transform:scale(1)}to{transform:scale(1.06)}}` +
  `[data-anim="float"]{animation:avc-float calc(var(--d,600ms)*3) ease-in-out infinite alternate}` +
  `[data-anim="pulse"]{animation:avc-pulse calc(var(--d,600ms)*2) ease-in-out infinite alternate}` +
  // Marquee: text crosses its box on a loop. The duration setting is the speed knob (default 600 ms gives a calm 12 s crossing).
  `@keyframes avc-marquee{from{text-indent:100%}to{text-indent:-100%}}` +
  `[data-anim="marquee"]{display:block;overflow:hidden;white-space:nowrap;animation:avc-marquee calc(var(--d,600ms)*20) linear infinite}` +
  `[data-anim="parallax"]{will-change:transform}` +
  // In the editor canvas nothing may move while a person is editing it.
  `.avc-still{animation:none!important;text-indent:0!important;transform:none!important}`;

const reduced = `@media (prefers-reduced-motion:reduce){[data-anim="marquee"]{white-space:normal!important;text-indent:0!important}}`;

export const ANIM_CSS =
  `[data-anim]{animation-fill-mode:both;animation-duration:var(--d,600ms);animation-delay:var(--dl,0ms);animation-timing-function:ease-out}` +
  keyframes + entrance + textFx + hover + attention +
  `@media (prefers-reduced-motion:reduce){[data-anim]{animation:none!important;transition:none!important;opacity:1!important;transform:none!important;max-width:none!important;clip-path:none!important;border-right:0!important}[data-anim] .avc-w{animation:none!important;opacity:1!important}[data-anim="shimmer"]{color:inherit!important;background:none!important}}` + reduced;

/** Reveals scroll-triggered elements once. Skipped entirely under reduced motion or without IntersectionObserver. */
export const ANIM_SCRIPT =
  "(function(){var d=document.documentElement;" +
  "if(!('IntersectionObserver' in window)||(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches))return;" +
  "var els=document.querySelectorAll('[data-trigger=\"scroll\"]');if(!els.length)return;d.classList.add('avc-js');" +
  "var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('avc-in');io.unobserve(e.target)}})},{threshold:.15});" +
  "els.forEach(function(el){io.observe(el)});" +
  // Parallax: while an element is near the screen, shift it by a fraction of its distance from the middle of the viewport.
  "var ps=document.querySelectorAll('[data-anim=\"parallax\"]');if(!ps.length)return;var q=0;" +
  "function u(){q=0;var h=innerHeight;ps.forEach(function(el){var r=el.getBoundingClientRect();if(r.bottom<-300||r.top>h+300)return;el.style.transform='translate3d(0,'+(((r.top+r.height/2)-h/2)*-0.12).toFixed(1)+'px,0)'})}" +
  "addEventListener('scroll',function(){if(!q)q=requestAnimationFrame(u)},{passive:true});addEventListener('resize',u);u()})();";

// Published contact forms. A published site is static files, so a form posts straight to the database's one public door,
// submit_form() (see supabase/migrations/20250102…): anonymous visitors can call only that function, with the public anon key.

export type FormsConfig = {
  /** Full URL of the submit_form RPC, e.g. https://xyz.supabase.co/rest/v1/rpc/submit_form */
  endpoint: string;
  /** The PUBLIC anon key. Never a service-role key. */
  key: string;
  /** Slug of the published site (public.sites.slug). */
  slug: string;
};

/** Form ids must match the database's ^[a-zA-Z0-9_-]{1,64}$ rule. */
export const formIdFor = (nodeId: string) => nodeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "form";

/** JSON that is safe to place inside an inline <script>: "<" can never start "</script>" or "<!--". */
const LS = new RegExp(String.fromCharCode(0x2028), "g"), PS = new RegExp(String.fromCharCode(0x2029), "g");
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(LS, "\\u2028").replace(PS, "\\u2029");

/**
 * The inline script for pages with forms. Plain ES5, no dependencies. It only ever writes to the page with textContent
 * (never innerHTML), sends only the three visible fields plus the honeypot, and reports a friendly message for every outcome.
 */
export function formScript(cfg: FormsConfig): string {
  return (
    `(function(){var C=${safeJson(cfg)};` +
    `var M={ok:"Thanks! Your message has been sent.",busy:"Too many messages right now. Please try again in a few minutes.",fail:"Sorry, that didn't send. Please try again.",net:"Couldn't reach the server. Check your connection and try again."};` +
    `function wire(f){var b=f.querySelector("button[type=submit]"),s=f.querySelector("[data-avc-status]"),sending=false;` +
    `function say(t,ok){if(s){s.textContent=t;s.setAttribute("data-state",ok?"ok":"error");}}` +
    `f.addEventListener("submit",function(e){e.preventDefault();if(sending)return;` +
    `function v(n){var el=f.elements[n];return el&&typeof el.value==="string"?el.value.trim():"";}` +
    `var fields={};["name","email","message"].forEach(function(n){var x=v(n);if(x)fields[n]=x.slice(0,2000);});` +
    `if(!fields.email&&!fields.message){say(M.fail,false);return;}` +
    `sending=true;if(b)b.disabled=true;say("Sending…",true);` +
    `var ctl=typeof AbortController==="function"?new AbortController():null,t=setTimeout(function(){if(ctl)ctl.abort();},15000);` +
    `fetch(C.endpoint,{method:"POST",headers:{"content-type":"application/json",apikey:C.key,authorization:"Bearer "+C.key},` +
    `body:JSON.stringify({p_site_slug:C.slug,p_form_id:f.getAttribute("data-avc-form"),p_fields:fields,p_honeypot:v("website")}),signal:ctl?ctl.signal:undefined})` +
    `.then(function(r){return r.text().then(function(x){return{status:r.status,text:x};});})` +
    `.then(function(r){if(r.status>=200&&r.status<300){f.reset();say(M.ok,true);}else if(r.status===429||/rate_limited/.test(r.text)){say(M.busy,false);}else{say(M.fail,false);}})` +
    `.catch(function(){say(M.net,false);})` +
    `.then(function(){clearTimeout(t);sending=false;if(b)b.disabled=false;});});}` +
    `Array.prototype.forEach.call(document.querySelectorAll("form[data-avc-form]"),wire);})();`
  );
}

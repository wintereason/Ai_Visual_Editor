// STARTER legal text for the PLATFORM itself (the editor that people sign up to and buy credits in), as opposed to legal.ts which
// is for a website a person builds. These are drafts, not legal advice. Anything the owner must decide is written as [[a blank]];
// the pages show a prominent DRAFT banner for as long as any blank remains, and docs/billing.md lists them as a launch blocker.

export type PlatformLegalKind = "terms" | "privacy" | "refunds";
export type PlatformLegalInput = { business: string; email: string; country: string; date: string; address?: string };
export type PlatformBlock = ["h", string] | ["p", string];

export const PLATFORM_LEGAL: Record<PlatformLegalKind, { title: string; path: string }> = {
  terms: { title: "Terms of Service", path: "/terms" },
  privacy: { title: "Privacy Policy", path: "/privacy" },
  refunds: { title: "Refund and Cancellation Policy", path: "/refunds" },
};

const clean = (s: string, max: number, fallback: string) => s.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || fallback;

export function platformLegal(kind: PlatformLegalKind, input: PlatformLegalInput): PlatformBlock[] {
  const b = clean(input.business, 80, "[[your business name]]");
  const e = clean(input.email, 120, "[[your support email]]");
  const country = clean(input.country, 60, "India");
  const date = clean(input.date, 40, "[[date]]");
  const addr = input.address ? clean(input.address, 200, "") : "";

  if (kind === "terms") return [
    ["p", `These terms are an agreement between you and ${b} ("we", "us") about your use of this website builder and its AI features. Last updated: ${date}. By creating an account or using the service you agree to them.`],
    ["h", "Your account"],
    ["p", "You must give a real email address and keep your sign-in links private. You are responsible for what happens under your account. You must be old enough to enter a contract where you live, or have a parent or guardian's permission."],
    ["h", "What you build"],
    ["p", "You own the content you create. You give us permission to store it and to process it only to run the service for you. You are responsible for your sites: they must be lawful, accurate and not infringe anyone's rights. Do not publish illegal, hateful, deceptive or sexually explicit content, impersonate others, or use the service to send spam or scams. We can remove content or suspend an account that breaks these rules."],
    ["h", "AI features"],
    ["p", "AI suggestions can be wrong, incomplete or similar to other people's work. You must check everything before you publish it, including facts such as fees, dates, results and claims. You are responsible for what you publish. We check requests and answers with automated safety filters, which are not perfect."],
    ["h", "Credits and payments"],
    ["p", "AI features use credits. Credits are bought in packs at the price shown when you buy, in Indian rupees, through our payment provider Razorpay. We never see or store your card details. A request that fails is not charged. Credits [[do / do not]] expire. Prices may change for future purchases."],
    ["h", "Publishing"],
    ["p", "Sites you publish go to the hosting account you connect (for example your own Cloudflare account). Your hosting provider's terms apply to that hosting. We are not responsible for outages or charges at your hosting provider."],
    ["h", "Availability and changes"],
    ["p", "We work to keep the service running but cannot promise it will always be available or error-free. We may change or end features, and will give reasonable notice of significant changes where we can."],
    ["h", "Limits on our responsibility"],
    ["p", `To the extent the law allows, ${b} is not liable for indirect or consequential loss, or for loss of data, profit or goodwill, and our total liability to you is limited to the amount you paid us in the 12 months before the claim. Nothing limits rights you have by law that cannot be limited. [[Have this section checked by a lawyer]]`],
    ["h", "Ending your account"],
    ["p", "You can delete your account at any time from the Projects window; this permanently deletes your data. We may suspend or close accounts that break these terms."],
    ["h", "Governing law"],
    ["p", `These terms are governed by the laws of ${country}. [[Name the city or state whose courts will handle disputes]]`],
    ["h", "Contact"],
    ["p", `${b}${addr ? `, ${addr}` : ""}. Email: ${e}.`],
  ];

  if (kind === "privacy") return [
    ["p", `This policy explains what personal information ${b} collects when you use this website builder, why, and your choices. Last updated: ${date}.`],
    ["h", "What we collect"],
    ["p", "Your email address (to sign you in); the projects, images and settings you save to your account; records of AI requests and credit use (when, how many credits, and counts of tokens used, but not the text of your prompts); payment records (which pack you bought, the amount and a payment reference). Our payment provider, Razorpay, handles your card or UPI details. We do not receive or store them."],
    ["p", "If you publish a site with a contact form, messages that visitors send are stored in your account so you can read them. You are responsible for telling your visitors how you use them (see the privacy page you can create for your own site)."],
    ["h", "How we use it"],
    ["p", "To run the service, keep your work safe, answer support requests, prevent abuse, process payments, and understand how much AI capacity is used. We do not sell your personal information."],
    ["h", "AI processing"],
    ["p", "When you use an AI feature, the content needed for that request (for example the page you are editing, your instructions, or a picture you choose) is sent to our AI provider, Anthropic, to produce the result. We send only what is needed for the request. [[Confirm how your AI provider uses and retains this data, and say so here]]"],
    ["h", "Who else sees it"],
    ["p", "Service providers that help us run the service: our database and sign-in provider (Supabase), our AI provider (Anthropic), our payment provider (Razorpay), and email delivery for sign-in links. They may process data only to provide their service. We also share information when the law requires it."],
    ["h", "Where it is stored"],
    ["p", "[[Say which country or region your database and providers are in]]"],
    ["h", "How long we keep it"],
    ["p", "Your account data is kept until you delete your account, which permanently deletes your projects, images, published-site records and messages. Payment records may be kept for [[number of years]] years where tax or accounting law requires it."],
    ["h", "Your choices and rights"],
    ["p", `You can download all your data and delete your account from the Projects window. You can also email ${e} to ask for access, correction or deletion, and we will respond within [[number of days]] days.`],
    ["h", "Cookies and local storage"],
    ["p", "The editor stores your sign-in session and some preferences in your browser so it works. It does not use advertising trackers."],
    ["h", "Children"],
    ["p", "The service is not meant for children under [[minimum age]] to use alone."],
    ["h", "Changes"],
    ["p", "If we change this policy we will update the date above and, for significant changes, tell you."],
    ["h", "Contact"],
    ["p", `${b}${addr ? `, ${addr}` : ""}. Email: ${e}.`],
  ];

  return [
    ["p", `This policy explains refunds and cancellation for credit packs bought from ${b}. Last updated: ${date}.`],
    ["h", "What you are buying"],
    ["p", "Credits let you use AI features. Each AI request shows how many credits it costs before you use it. A request that fails, is blocked by our safety checks, or cannot be completed is not charged."],
    ["h", "Refunds"],
    ["p", "If a payment was taken but credits did not arrive, email us and we will fix it or refund you. If you paid by mistake, or were charged twice, we will refund you. For unused credits, [[we will / we will not]] refund within [[number of days]] days of purchase. Credits that have been used are not refundable."],
    ["h", "How refunds are paid"],
    ["p", "Refunds go back to the original payment method within [[number of working days]] working days of approval."],
    ["h", "Cancelling"],
    ["p", "There is no subscription: you only pay when you buy a pack, so there is nothing to cancel. You can delete your account at any time."],
    ["h", "Contact"],
    ["p", `Refund questions: ${e}.`],
  ];
}

/** True while any [[blank]] is still in the text: the pages show a DRAFT banner until it is false. */
export const hasBlanks = (blocks: PlatformBlock[]) => blocks.some(([, t]) => /\[\[[^\]]{1,200}\]\]/.test(t));

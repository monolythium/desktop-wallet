// Static content for the in-app Help page. Plain-language answers to what a new
// or stuck user actually needs — every one TRUE of this wallet today (no-mock):
// no emergency-key recovery, no hardware wallet, no support inbox we don't have.
//
// The chain-health "what to do" guidance is NOT authored here — the Help page
// pulls it live from `chainHealthHelpEntries()` so it can't drift from the chip
// and banner copy. Support links are NOT invented here — they are filtered from
// the canonical `EXTERNAL_LINKS` the Resources page already ships; there is no
// dedicated support email or chat channel, and we never fabricate one.

import { EXTERNAL_LINKS, type ExternalLink } from "./chain-content";

/** One question with one or more plain-language answer paragraphs. */
export interface HelpQA {
  q: string;
  a: string[];
}

/** A titled group of Q&As, rendered as one card. */
export interface HelpSection {
  title: string;
  items: HelpQA[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    title: "Recovery phrase & backups",
    items: [
      {
        q: "What is a recovery phrase, and how do I keep it safe?",
        a: [
          "Your recovery phrase is the 24 words this wallet generated when you created it. Together they are your wallet: anyone who has them can move your funds, and they are the only way to restore the wallet on another device.",
          "Write them on paper and keep them somewhere private and offline. Don't screenshot them, and don't store them in cloud notes, photos, or a password manager that syncs — a copy you can't delete can be stolen. Never type them into a website or share them with anyone.",
          "No one from Monolythium — no support agent, no \"foundation\" — will ever ask for them. Anyone who does is trying to steal your funds.",
        ],
      },
      {
        q: "What happens if I lose my recovery phrase?",
        a: [
          "If you lose the 24 words and don't have the wallet unlocked on a device, the funds are gone. No one — not this wallet's makers, not any support agent — can recover a lost phrase for you. This wallet has no password-reset and no backdoor by design.",
        ],
      },
    ],
  },
  {
    title: "Resetting & restoring",
    items: [
      {
        q: "How do I restore my wallet on a new device?",
        a: [
          "Install the wallet, choose Import, and enter your 24-word recovery phrase. The same words always rebuild the same wallet and address, so your funds reappear once the wallet reconnects to the network.",
        ],
      },
      {
        q: "How do I reset the wallet, and what does it erase?",
        a: [
          "Settings → Reset erases the wallet data stored on this device. To confirm, you must enter this wallet's 24-word recovery phrase — proof that you can restore it afterward — because a reset can't be undone from the app.",
          "There is no \"forgot my phrase\" path: if you can't provide the recovery phrase, the reset can't complete, because completing it without a backup would destroy the only way to recover your funds.",
        ],
      },
    ],
  },
  {
    title: "Fees & delegation",
    items: [
      {
        q: "Why is the network fee paid in LYTH?",
        a: [
          "Every transaction pays its network fee in the chain's native token, LYTH — even when you're sending a different token. If you don't hold enough LYTH to cover the fee, the transfer is blocked before it's signed.",
          "The fee shown before you send is the maximum the network reserves. The actual charge is usually lower and is settled when the transaction is included.",
        ],
      },
      {
        q: "What does the 50% delegation cap mean?",
        a: [
          "To stop any single operator cluster from gaining too much influence, the network caps how much of your stake you can delegate to one cluster at 50%. Your total delegation across every cluster can't exceed 100%.",
          "If a delegation would cross the 50% per-cluster cap, reduce the amount or choose another cluster.",
        ],
      },
    ],
  },
];

/** Help/support links — filtered from the canonical Resources links, NOT invented.
 *  Documentation and the source repository are the real places to read more or
 *  file an issue. There is intentionally no support email or chat: we surface
 *  only channels the wallet already ships. */
export const HELP_LINK_LABELS = ["Documentation", "GitHub", "Monolythium"] as const;

export const HELP_LINKS: ExternalLink[] = EXTERNAL_LINKS.filter((l) =>
  (HELP_LINK_LABELS as readonly string[]).includes(l.label),
);

// Common-password denylist.
//
// Scope, stated honestly: this is defense-in-depth, NOT an exhaustive breach
// check. A few hundred entries cannot stand in for a breach-corpus lookup, and
// the wallet does not pretend otherwise — it never claims a password is "safe",
// only that a specific guessable one is refused.
//
// Every entry is a genuinely common or trivially-guessable password drawn from
// public common-password corpora (rockyou-derived top lists and the widely
// published most-common rankings), plus this service's own context terms.
// Nothing here is invented filler: a fabricated entry would be a rule the user
// trips over for no real-world reason.
//
// The >= 15 code-point tier matters most. Below the length floor the denylist is
// redundant — a 12-character classic is already rejected for being short — so
// without long entries the `common` reject path would be unreachable and the
// check would be decorative. The long tier is what makes it real: passphrases
// that clear the floor while remaining among the first things an attacker tries.
//
// Matching normalizes case and surrounding whitespace FOR THE LOOKUP ONLY. The
// stored secret is never trimmed or case-folded — the bytes the user typed are
// the bytes that reach Argon2id.

/** Genuinely common passwords, lowercased. */
const ENTRIES: readonly string[] = [
  // ── Universal classics (public top-100 lists) ────────────────────────────
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd",
  "p@ssword",
  "p@ssw0rd",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "12345",
  "1234",
  "111111",
  "000000",
  "123123",
  "654321",
  "666666",
  "121212",
  "112233",
  "abc123",
  "a1b2c3",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "qwerty1",
  "asdfgh",
  "asdfghjkl",
  "zxcvbn",
  "zxcvbnm",
  "1qaz2wsx",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "letmein",
  "welcome",
  "welcome1",
  "welcome123",
  "admin",
  "admin123",
  "administrator",
  "root",
  "toor",
  "guest",
  "login",
  "master",
  "dragon",
  "monkey",
  "monkey123",
  "football",
  "baseball",
  "basketball",
  "superman",
  "batman",
  "iloveyou",
  "trustno1",
  "sunshine",
  "princess",
  "starwars",
  "whatever",
  "shadow",
  "michael",
  "jennifer",
  "jordan23",
  "hunter2",
  "freedom",
  "computer",
  "internet",
  "secret",
  "changeme",
  "default",
  "temp123",
  "test123",
  "pass123",
  "photoshop",
  "michelle",
  "charlie",
  "donald",
  "flower",
  "cheese",
  "ginger",
  "chocolate",
  "soccer",
  "hockey",
  "killer",
  "hello",
  "hello123",
  "loveme",
  "lovely",
  "samsung",
  "google",
  "facebook",
  "myspace1",
  "linkedin",
  "matrix",
  "ranger",
  "buster",
  "harley",
  "robert",
  "thomas",
  "daniel",
  "andrew",
  "joshua",
  "matthew",
  "access",
  "mustang",
  "pepper",
  "maggie",
  "tigger",
  "summer",
  "banana",
  "orange",
  "purple",
  "silver",
  "diamond",
  "phoenix",
  "gandalf",
  "merlin",
  "nintendo",
  "pokemon",
  "minecraft",
  "starcraft",
  "aa123456",
  "abcd1234",
  "abc12345",
  "1qazxsw2",
  "qazwsx",
  "asdf1234",
  "qwe123",
  "qweasd",
  "159753",
  "789456123",
  "147258369",
  "987654321",
  "asdasd",
  "zaq12wsx",
  "q1w2e3r4",

  // ── >= 15 code points: the tier that makes this check reachable ─────────
  // Well-known long passphrases (the xkcd example is among the first strings
  // any attacker tries precisely because it is famous for being "strong").
  "correcthorsebatterystaple",
  "correct horse battery staple",
  "correcthorsebatterystaple1",
  "thequickbrownfox",
  "thequickbrownfoxjumpsoverthelazydog",
  "the quick brown fox",
  "tobeornottobe",
  "tobeornottobethatisthequestion",
  "lorem ipsum dolor sit amet",
  "loremipsumdolorsitamet",
  // Doubled / tripled common words — long by construction, trivially guessed.
  "passwordpassword",
  "password password",
  "passwordpasswordpassword",
  "passwordpassword1",
  "qwertyqwerty",
  "qwertyqwertyqwerty",
  "abc123abc123abc1",
  "letmeinletmein",
  "welcomewelcome",
  "iloveyouiloveyou",
  "monkeymonkeymonkey",
  "dragondragondragon",
  "adminadminadmin",
  "secretsecretsecret",
  "changemechangeme",
  // Long straight runs and keyboard walks.
  "123456789012345",
  "1234567890123456",
  "12345678901234567890",
  "111111111111111",
  "000000000000000",
  "aaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaa",
  "xxxxxxxxxxxxxxx",
  "qwertyuiopasdfgh",
  "qwertyuiopasdfghjkl",
  "qwertyuiopasdfghjklzxcvbnm",
  "asdfghjklzxcvbnm",
  "1qaz2wsx3edc4rfv",
  "1q2w3e4r5t6y7u8i",
  "abcdefghijklmnop",
  "abcdefghijklmnopqrstuvwxyz",
  // Long sentence-shaped classics.
  "letmeinplease123",
  "iloveyousomuch12",
  "ihatepasswords1",
  "mypasswordis1234",
  "thisismypassword",
  "this is my password",
  "openthedoorplease",
  "supersecretpassword",
  "verysecurepassword",
  "notmyrealpassword",

  // ── Service-context terms (verbatim per the policy) ─────────────────────
  "monolythium",
  "monolythium1",
  "monolythium123",
  "cryptowallet",
  "cryptowallet1",
  // Service name at >= 15 with the usual suffixes.
  "monolythiumwallet",
  "monolythiumwallet1",
  "monolythium wallet",
  "monolythiumwallet123",
  "monolythiumpassword",
  "cryptowallet123456",
  "mycryptowallet123",
];

const COMMON_PASSWORDS: ReadonlySet<string> = new Set(ENTRIES);

/** How many entries the denylist carries. Exported so a test can assert the
 *  list stayed a real list rather than silently emptying. */
export const COMMON_PASSWORD_COUNT = COMMON_PASSWORDS.size;

/** True when the password is on the denylist.
 *
 *  Normalizes case and surrounding whitespace for the COMPARISON ONLY — the
 *  caller's secret is untouched and reaches the KDF exactly as typed. Pure. */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.trim().toLowerCase());
}

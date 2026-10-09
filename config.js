// Crossings configuration: the only file you normally need to edit.
window.APP_CONFIG = {
  // Paste the Apps Script web app URL (ends in /exec). Leave "" for demo mode
  // (anyone can sign in, nothing is saved to the sheet).
  scriptUrl: "",

  // Question banks. Add a new JSON file to data/ and list it here. Encrypted
  // banks (tools/encrypt_bank.py) show a password screen first.
  // The first bank is the default; others are reachable from the home screen
  // or with ?bank=<id> in the URL.
  banks: [
    { id: "apush-u1u2", file: "data/apush-u1u2.enc.json" },
  ],

  // Shown when a name can't be matched.
  teacherName: "your teacher",
};

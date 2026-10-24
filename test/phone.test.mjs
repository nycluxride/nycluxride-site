import assert from "node:assert/strict";
import { COUNTRIES, MAIN_BY_DIAL, TRUNK, phoneText, readPhone } from "../api/_phone.mjs";

const DASHES = /[\u2013\u2014;]/;
const dials = [...new Set(COUNTRIES.map(([, , dial]) => dial))];
const countriesOf = (dial) => COUNTRIES.filter((row) => row[2] === dial).map(([iso]) => iso);

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 14).join("\n       ")}`);
  }
}

test("COUNTRIES has 244 rows of an ISO code, an English name and a dial code", () => {
  assert.equal(COUNTRIES.length, 244);
  for (const row of COUNTRIES) {
    assert.equal(row.length, 3, JSON.stringify(row));
    const [iso, name, dial] = row;
    assert.match(iso, /^[A-Z]{2}$/, JSON.stringify(row));
    assert.ok(name && name === name.trim() && !/\s{2}/.test(name), JSON.stringify(row));
    assert.match(dial, /^[1-9]\d{0,2}$/, JSON.stringify(row));
  }
  assert.deepEqual(COUNTRIES.find(([iso]) => iso === "US"), ["US", "United States", "1"]);
  assert.deepEqual(COUNTRIES.find(([iso]) => iso === "GB"), ["GB", "United Kingdom", "44"]);
  assert.deepEqual(["XK", "AC"].map((iso) => COUNTRIES.find((row) => row[0] === iso)), [["XK", "Kosovo", "383"], ["AC", "Ascension Island", "247"]]);
  for (const iso of ["AQ", "BV", "HM", "TF", "UM", "PN", "GS", "TA"]) assert.ok(!COUNTRIES.some((row) => row[0] === iso), iso);
  const named = Object.fromEntries(COUNTRIES.map(([iso, name]) => [iso, name]));
  assert.deepEqual(["AX", "CI", "CW", "RE", "BL", "ST", "TR"].map((iso) => named[iso]), ["Åland Islands", "Côte d'Ivoire", "Curaçao", "Réunion", "Saint Barthélemy", "São Tomé and Príncipe", "Türkiye"]);
  for (const [, name] of COUNTRIES) assert.equal(name, name.normalize("NFC"), name);
});

test("the ISO codes and the names are unique, and the rows are in English name order", () => {
  assert.equal(new Set(COUNTRIES.map(([iso]) => iso)).size, COUNTRIES.length);
  assert.equal(new Set(COUNTRIES.map(([, name]) => name)).size, COUNTRIES.length);
  assert.deepEqual(COUNTRIES.map(([, name]) => name), COUNTRIES.map(([, name]) => name).sort((a, b) => a.localeCompare(b, "en")));
  assert.deepEqual(COUNTRIES.slice(0, 3).map(([iso]) => iso), ["AF", "AX", "AL"]);
  assert.deepEqual(COUNTRIES.at(-1), ["ZW", "Zimbabwe", "263"]);
});

test("the names hold no en dash, em dash or semicolon", () => {
  for (const [, name] of COUNTRIES) assert.ok(!DASHES.test(name), name);
});

test("no dial code is the start of another, so a + number has at most one code at its start", () => {
  for (const a of dials) for (const b of dials) assert.ok(a === b || !b.startsWith(a), `${a} starts ${b}`);
});

test("MAIN_BY_DIAL names one of its countries for every shared dial code and only those", () => {
  const shared = dials.filter((dial) => countriesOf(dial).length > 1).sort();
  assert.deepEqual(Object.keys(MAIN_BY_DIAL).sort(), shared);
  assert.deepEqual(MAIN_BY_DIAL, { 1: "US", 7: "RU", 39: "IT", 44: "GB", 47: "NO", 61: "AU", 212: "MA", 262: "RE", 358: "FI", 590: "GP", 599: "CW" });
  for (const [dial, iso] of Object.entries(MAIN_BY_DIAL)) assert.ok(countriesOf(dial).includes(iso), `${dial} ${iso}`);
  assert.equal(countriesOf("1").length, 25);
});

test("every TRUNK key is a country of the list, with a national prefix of digits or none", () => {
  assert.deepEqual(TRUNK, { BF: "", BJ: "", CG: "", CI: "", GA: "", IT: "", SM: "", TJ: "", VA: "", BY: "80", HU: "06", KZ: "8", RU: "8" });
  for (const [iso, prefix] of Object.entries(TRUNK)) {
    assert.ok(COUNTRIES.some((row) => row[0] === iso), iso);
    assert.match(prefix, /^\d{0,2}$/, iso);
  }
});

const TABLE = [
  ["US", "2125550100", "+1 212 555 0100"],
  ["US", "(212) 555-0100", "+1 212 555 0100"],
  ["US", "1 212 555 0100", "+1 212 555 0100"],
  ["US", "+1 1 212 555 0100", "+1 212 555 0100"],
  ["US", "+1242 555 0100", "+1 242 555 0100"],
  ["US", "555-0100", ""],
  ["US", "123 456 7890", ""],
  ["US", "212 155 0100", ""],
  ["US", "0207 946 0958", ""],
  ["US", "+44 7700 900123", "+44 7700 900123"],
  ["US", "0044 7700 900123", "+44 7700 900123"],
  ["US", "011 44 7700 900123", "+44 7700 900123"],
  ["GB", "7700 900123", "+44 7700 900123"],
  ["GB", "07700 900123", "+44 7700 900123"],
  ["GB", "+44 07700 900123", "+44 7700 900123"],
  ["GB", "+44 (0)20 7946 0958", "+44 20 7946 0958"],
  ["DE", "+49 171/1234567", "+49 171 1234567"],
  ["DE", "0171 1234567", "+49 171 1234567"],
  ["FR", "06 12 34 56 78", "+33 6 12 34 56 78"],
  ["AU", "0412 345 678", "+61 412 345 678"],
  ["IT", "06 1234 5678", "+39 06 1234 5678"],
  ["IT", "347 123 4567", "+39 347 123 4567"],
  ["BJ", "01 97 12 34 56", "+229 01 97 12 34 56"],
  ["RU", "8 912 345 67 89", "+7 912 345 67 89"],
  ["RU", "812 123 45 67", "+7 812 123 45 67"],
  ["BY", "8 029 123 45 67", "+375 29 123 45 67"],
  ["BY", "029 123 45 67", "+375 29 123 45 67"],
  ["HU", "06 30 123 4567", "+36 30 123 4567"],
  ["JP", "090-1234-5678", "+81 90 1234 5678"],
  ["JP", "＋８１ ９０１２３４５６７８", "+81 9012345678"],
  ["AE", "+٩٧١٥٠١٢٣٤٥٦٧", "+971 501234567"],
  ["NU", "+683 1234", "+683 1234"],
  ["CA", "+7 495 123 45 67", "+7 495 123 45 67"],
  [undefined, "2125550100", "+1 212 555 0100"],
  ["ZZ", "7700 900123", ""],
  ["ZZ", "+44 7700 900123", "+44 7700 900123"],
  ["US", "+888 1234 5678", ""],
  ["US", "+1 212 555 0100 x2", ""],
  ["US", "call me", ""],
  ["GB", "44 7911 123456", "+44 7911 123456"],
  ["GB", "447911123456", "+44 7911123456"],
  ["GB", "44 07911 123456", "+44 7911 123456"],
  ["FR", "33 6 12 34 56 78", "+33 6 12 34 56 78"],
  ["RU", "7 912 345 67 89", "+7 912 345 67 89"],
  ["BR", "55 11 91234 5678", "+55 11 91234 5678"],
  ["BR", "55 99123 4567", "+55 55 99123 4567"],
  ["IN", "9123456789", "+91 9123456789"],
  ["KZ", "7011234567", "+7 7011234567"],
  ["IT", "3931234567", "+39 3931234567"],
  ["FR", "3 33 12 34 56", "+33 3 33 12 34 56"],
];

test("readPhone gives the table of the spec: the code from the picker or the + number, one national prefix dropped, the text with its country code", () => {
  for (const [cc, input, text] of TABLE) {
    const result = readPhone(input, cc);
    const name = `${cc} ${JSON.stringify(input)}`;
    if (!text) {
      assert.deepEqual(result, { ok: false, text: phoneText(input) }, name);
      continue;
    }
    assert.deepEqual(result, { ok: true, text, dial: text.slice(1).split(" ")[0] }, name);
  }
});

test("readPhone reads its own text back the same way, so the server can check the stored number again", () => {
  for (const [cc, input, text] of TABLE) if (text) assert.deepEqual(readPhone(text, cc), readPhone(input, cc), `${cc} ${input}`);
  for (const [iso, , dial] of COUNTRIES) {
    const first = readPhone(dial === "1" ? "212 555 0100" : "0 1234 5678", iso);
    assert.deepEqual(readPhone(first.text, iso), first, iso);
  }
});

test("every country reads a national number and the same number written with + and its code", () => {
  for (const [iso, , dial] of COUNTRIES) {
    const local = dial === "1" ? "212 555 0100" : "1234 5678";
    const text = dial === "1" ? "+1 212 555 0100" : `+${dial} 1234 5678`;
    assert.deepEqual(readPhone(local, iso), { ok: true, text, dial }, iso);
    assert.deepEqual(readPhone(`+${dial} ${local}`, iso), { ok: true, text, dial }, iso);
    assert.deepEqual(readPhone(`00${dial} ${local}`, iso), { ok: true, text, dial }, iso);
  }
});

test("a + number of a code another country shares is read with the country chosen, else the main country of the code", () => {
  assert.deepEqual(readPhone("+44 7624 123456", "IM"), { ok: true, text: "+44 7624 123456", dial: "44" });
  assert.deepEqual(readPhone("+7 701 123 4567", "KZ"), readPhone("8 701 123 4567", "KZ"));
  assert.deepEqual(readPhone("+7 8 912 345 67 89", "US"), { ok: true, text: "+7 912 345 67 89", dial: "7" });
  assert.deepEqual(readPhone("+39 06 1234 5678", "SM"), { ok: true, text: "+39 06 1234 5678", dial: "39" });
  assert.deepEqual(readPhone("+39 06 1234 5678", "GB"), { ok: true, text: "+39 06 1234 5678", dial: "39" });
  assert.deepEqual(readPhone("+229 01 97 12 34 56", "US"), { ok: true, text: "+229 01 97 12 34 56", dial: "229" });
});

test("011 starts an international number only with a +1 country, and the 8 of Russia goes only from 11 digits", () => {
  assert.deepEqual(readPhone("011 44 7700 900123", "CA"), { ok: true, text: "+44 7700 900123", dial: "44" });
  assert.equal(readPhone("011 44 7700 900123", "GB").ok, false);
  assert.deepEqual(readPhone("011 1 212 555 0100", "US"), { ok: true, text: "+1 212 555 0100", dial: "1" });
  assert.deepEqual(readPhone("8 (812) 123-45-67", "RU"), { ok: true, text: "+7 812 123 45 67", dial: "7" });
  assert.deepEqual(readPhone("8 701 123 4567", "KZ"), { ok: true, text: "+7 701 123 4567", dial: "7" });
  assert.deepEqual(readPhone("06 1 234 5678", "HU"), { ok: true, text: "+36 1 234 5678", dial: "36" });
  assert.deepEqual(readPhone("0612 34567", "LT"), { ok: true, text: "+370 612 34567", dial: "370" });
  assert.deepEqual(readPhone("07 07 12 34 56", "CI"), { ok: true, text: "+225 07 07 12 34 56", dial: "225" });
  assert.deepEqual(readPhone("061 234 567", "CG"), { ok: true, text: "+242 061 234 567", dial: "242" });
  assert.deepEqual(readPhone("07 12 34 56", "BF"), { ok: true, text: "+226 07 12 34 56", dial: "226" });
  assert.deepEqual(readPhone("+226 07 12 34 56", "US"), { ok: true, text: "+226 07 12 34 56", dial: "226" });
  assert.deepEqual(readPhone("70 12 34 56", "BF"), { ok: true, text: "+226 70 12 34 56", dial: "226" });
  assert.deepEqual(readPhone("01 123 4567", "TJ"), { ok: true, text: "+992 01 123 4567", dial: "992" });
  assert.deepEqual(readPhone("+992 917 123 456", "TJ"), { ok: true, text: "+992 917 123 456", dial: "992" });
  assert.deepEqual(readPhone("06 1234 5678", "SM"), { ok: true, text: "+378 06 1234 5678", dial: "378" });
});

test("readPhone needs 4 national digits and 7 to 15 digits with the code, and keeps a bad number as typed up to 32 characters", () => {
  assert.equal(readPhone("+683 1234", "NU").ok, true);
  assert.equal(readPhone("+683 123", "NU").ok, false);
  assert.equal(readPhone("+44 123", "GB").ok, false);
  assert.equal(readPhone("+44 1234 5678 9012 3", "GB").ok, true);
  assert.equal(readPhone("+44 1234 5678 9012 34", "GB").ok, false);
  assert.equal(readPhone("+1 212 555 01001", "US").ok, false);
  for (const value of ["", "   ", null, undefined, "\u200e"]) assert.deepEqual(readPhone(value, "US"), { ok: false, text: "" }, JSON.stringify(value));
  assert.deepEqual(readPhone("call me", "US"), { ok: false, text: "call me" });
  assert.deepEqual(readPhone("x".repeat(40), "US"), { ok: false, text: "x".repeat(32) });
  assert.deepEqual(readPhone("+", "US"), { ok: false, text: "+" });
  assert.deepEqual(readPhone("+44", "GB"), { ok: false, text: "+44" });
  assert.equal(readPhone("(+44) 7700 900123", "GB").ok, false);
  assert.equal(readPhone("212 555 0100 ext 4", "US").ok, false);
});

test("a missing country code reads as the United States, a code in small letters as its country, an unknown one reads only + numbers", () => {
  for (const cc of [undefined, null, ""]) assert.deepEqual(readPhone("(212) 555-0100", cc), { ok: true, text: "+1 212 555 0100", dial: "1" }, String(cc));
  assert.deepEqual(readPhone("07700 900123", "gb"), { ok: true, text: "+44 7700 900123", dial: "44" });
  for (const cc of ["ZZ", "USA", "constructor", "__proto__"]) {
    assert.equal(readPhone("212 555 0100", cc).ok, false, cc);
    assert.deepEqual(readPhone("+1 212 555 0100", cc), { ok: true, text: "+1 212 555 0100", dial: "1" }, cc);
  }
});

test("phoneText turns any digits, dashes, spaces and format marks into plain text", () => {
  const ch = (...codes) => String.fromCharCode(...codes);
  assert.equal(phoneText(`${ch(0x200e)}+1 212${ch(0x2011)}555${ch(0x2011)}0100${ch(0x200e)}`), "+1 212-555-0100");
  assert.equal(phoneText(`+44${ch(0xa0)}7700${ch(0xa0)}900123`), "+44 7700 900123");
  assert.equal(phoneText(`646 ${ch(0x2013)} 775 ${ch(0x2013)} 0556`), "646 - 775 - 0556");
  assert.equal(phoneText(`+1 212${ch(0x2212)}555${ch(0x2212)}0100`), "+1 212-555-0100");
  assert.equal(phoneText("+49 171/1234567"), "+49 171 1234567");
  assert.equal(phoneText(`+${[..."971501234567"].map((d) => ch(0x6f0 + Number(d))).join("")}`), "+971501234567");
  assert.equal(phoneText(`${ch(0x202a)}+44 7700 900123${ch(0x202c)}`), "+44 7700 900123");
  assert.equal(phoneText(undefined), "");
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll phone tests passed");

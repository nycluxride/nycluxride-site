import { connect } from "node:tls";
import { isIP } from "node:net";
import { randomBytes } from "node:crypto";

const CRLF = "\r\n";
const MAX_LINE = 78;
const WORD_BYTES = 39;
const MAX_REPLY = 65536;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]+/g;
const ADDRESS = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const LINES = /\r\n|\r|\n/g;

export const headerText = (value) => String(value ?? "").replace(CONTROLS, " ").replace(/ {2,}/g, " ").trim();
export const addressOk = (text) => typeof text === "string" && text.length <= 254 && ADDRESS.test(text);

function encodedWords(text) {
  const words = [];
  let chunk = "";
  for (const ch of text) {
    if (chunk && Buffer.byteLength(chunk + ch) > WORD_BYTES) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`);
}

function fold(line) {
  if (line.length <= MAX_LINE) return line;
  const out = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current && current.length + 1 + word.length > MAX_LINE) {
      out.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

export function header(name, value) {
  const text = headerText(value);
  if (/^[\x20-\x7e]*$/.test(text)) return fold(`${name}: ${text}`);
  return `${name}: ${encodedWords(text).join(`${CRLF} `)}`;
}

export function mailbox({ name, address }) {
  if (!addressOk(address)) throw new Error("address");
  const text = headerText(name);
  if (!text) return address;
  if (/^[\x20-\x7e]*$/.test(text)) return `"${text.replace(/["\\]/g, "\\$&")}" <${address}>`;
  return `${encodedWords(text).join(" ")} <${address}>`;
}

const addressHeader = (name, list) => fold(`${name}: ${list.map(mailbox).join(", ")}`);
const base64 = (text) => Buffer.from(String(text).replace(LINES, CRLF)).toString("base64").replace(/.{1,76}/g, (part) => `${part}${CRLF}`);

export function buildMessage({ from, to, replyTo, subject, text, html, id, date = new Date() }) {
  const boundary = `nlr-${randomBytes(12).toString("hex")}`;
  const part = (type, body) => `--${boundary}${CRLF}Content-Type: ${type}; charset=utf-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${base64(body)}`;
  return [
    addressHeader("From", [from]),
    addressHeader("To", to),
    ...(replyTo ? [addressHeader("Reply-To", [replyTo])] : []),
    header("Subject", subject),
    `Date: ${date.toUTCString().replace(/GMT$/, "+0000")}`,
    `Message-ID: <${id}@${from.address.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `${part("text/plain", text)}${part("text/html", html)}--${boundary}--`,
  ].join(CRLF);
}

export const dotStuff = (data) => String(data).replace(LINES, CRLF).replace(/(^|\r\n)\./g, "$1..");

function replies(socket) {
  const queue = [];
  const waiting = [];
  let buffer = "";
  let failure = null;
  const push = (item) => (waiting.length ? waiting.shift()(item) : queue.push(item));
  const stop = (error) => {
    if (!failure) failure = error;
    while (waiting.length) waiting.shift()({ error: failure });
  };
  socket.on("data", (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at).replace(/\r$/, "");
      buffer = buffer.slice(at + 1);
      if (/^\d{3}(?!-)/.test(line)) push({ code: Number(line.slice(0, 3)) });
    }
    if (buffer.length > MAX_REPLY) socket.destroy(Object.assign(new Error("reply"), { code: "reply" }));
  });
  socket.on("error", stop);
  socket.on("close", () => stop(Object.assign(new Error("closed"), { code: "closed" })));
  return () => (queue.length ? Promise.resolve(queue.shift()) : failure ? Promise.resolve({ error: failure }) : new Promise((resolve) => waiting.push(resolve)));
}

class SmtpError extends Error {
  constructor(stage, code) {
    super(`${stage} ${code}`);
    this.stage = stage;
    this.code = code;
  }
}

export async function smtpSend({ host, port, user, pass, helo }, mails, timeout) {
  const results = mails.map((mail) => (addressOk(mail.from) && mail.to.length && mail.to.every(addressOk) ? { ok: false, stage: "connect", code: "" } : { ok: false, stage: "address", code: "" }));
  if (results.every((result) => result.stage === "address")) return results;
  const socket = connect({ host, port, ...(isIP(host) ? {} : { servername: host }), minVersion: "TLSv1.2", rejectUnauthorized: true });
  socket.setEncoding("utf8");
  const timer = setTimeout(() => socket.destroy(Object.assign(new Error("timeout"), { code: "timeout" })), timeout);
  const next = replies(socket);
  let stage = "connect";
  const reply = async () => {
    const answer = await next();
    if (answer.error) throw new SmtpError(stage, answer.error.code || "error");
    return answer.code;
  };
  const expect = async (codes) => {
    const code = await reply();
    if (!codes.includes(code)) throw new SmtpError(stage, code);
  };
  const send = (line, name) => {
    stage = name;
    socket.write(`${line}${CRLF}`);
  };
  const reset = async (failed, code) => {
    send("RSET", "rset");
    await expect([250]);
    return { ok: false, stage: failed, code };
  };
  const transact = async (mail) => {
    send(`MAIL FROM:<${mail.from}>`, "mail");
    let code = await reply();
    if (code !== 250) return reset("mail", code);
    let accepted = 0;
    let refused = 0;
    for (const to of mail.to) {
      send(`RCPT TO:<${to}>`, "rcpt");
      code = await reply();
      if (code === 250 || code === 251) accepted++;
      else refused = code;
    }
    if (!accepted) return reset("rcpt", refused);
    send("DATA", "data");
    code = await reply();
    if (code !== 354) return reset("data", code);
    stage = "message";
    socket.write(`${dotStuff(mail.data)}${CRLF}.${CRLF}`);
    code = await reply();
    return code === 250 ? { ok: true, stage: "message", code, rejected: mail.to.length - accepted } : { ok: false, stage: "message", code };
  };
  let index = 0;
  try {
    await expect([220]);
    send(`EHLO ${helo}`, "ehlo");
    await expect([250]);
    send(`AUTH PLAIN ${Buffer.from(`\u0000${user}\u0000${pass}`).toString("base64")}`, "auth");
    await expect([235]);
    for (; index < mails.length; index++) if (results[index].stage !== "address") results[index] = await transact(mails[index]);
    send("QUIT", "quit");
    await next();
  } catch (error) {
    const failed = error instanceof SmtpError ? error : new SmtpError(stage, "error");
    for (let i = index; i < mails.length; i++) if (!results[i].ok && results[i].stage !== "address") results[i] = { ok: false, stage: failed.stage, code: failed.code };
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
  return results;
}

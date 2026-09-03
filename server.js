/**
 * Random text-chat server.
 *
 * Pairs anonymous visitors for one-on-one text chat. No accounts, no email.
 * Age gate is a self-declared checkbox on the client — see README for why
 * that is a weak control and what to add before any real/public launch.
 *
 * Safety layers included here:
 *  - profanity filter on outgoing messages
 *  - automatic end-of-chat when a message looks like someone disclosing
 *    they are under 18 (regex-based, imperfect, logged for review)
 *  - supportive message + crisis resource pointer on self-harm language
 *    (chat is NOT ended for this — the person may just need someone to talk to)
 *  - per-socket message rate limiting
 *  - a Report button that ends the chat and appends a record (with a short
 *    rolling transcript of the reported user's recent messages) to reports.jsonl
 *
 * None of this is a substitute for real age verification, human moderation,
 * or legal review before operating this publicly. See README.md.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Filter = require('bad-words');

const PORT = process.env.PORT || 3000;
const REPORTS_FILE = path.join(__dirname, 'reports.jsonl');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const filter = new Filter();

// ---- safety heuristics -----------------------------------------------

// Looks for common ways people state they are under 18 in casual chat:
// "im 14", "i am 15 years old", "age: 13", "14f", "16 m", etc.
// This is intentionally conservative-leaning (catches more, false-positives
// included) because the cost of a false positive (chat ends, both sides can
// requeue) is far lower than the cost of a false negative here.
const MINOR_DISCLOSURE_PATTERNS = [
  /\b(?:i'?m|i am|im)\s*(?:only\s*)?(\d{1,2})\b/i,
  /\bage[:\s]*?(\d{1,2})\b/i,
  /\b(\d{1,2})\s*(?:years?\s*old|yo|y\/o)\b/i,
  /\b(\d{1,2})\s*[mf]\b/i,
  /\bi'?m in (?:middle|high) school\b/i,
];

function mentionsMinorAge(text) {
  for (const pattern of MINOR_DISCLOSURE_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1] !== undefined) {
      const age = parseInt(match[1], 10);
      if (!Number.isNaN(age) && age > 0 && age < 18) return age;
    } else if (match && pattern.source.includes('school')) {
      return 'school-mention';
    }
  }
  return null;
}

const SELF_HARM_PATTERNS = [
  /\bkill(?:ing)? myself\b/i,
  /\bsuicid(e|al)\b/i,
  /\bwant(?:ed|s|ing)?\s+to\s+die\b/i,
  /\bself[\s-]?harm\b/i,
  /\bcutting myself\b/i,
  /\bend(?:ing)? it all\b/i,
  /\bno reason to live\b/i,
  /\bdon'?t want to (?:be here|live) anymore\b/i,
];

function mentionsSelfHarm(text) {
  return SELF_HARM_PATTERNS.some((p) => p.test(text));
}

const SELF_HARM_RESPONSE =
  "It sounds like things might be really hard right now. You don't have to go through it alone — " +
  'you can reach a crisis line anytime at https://findahelpline.com (in the US: call or text 988). ' +
  'This is an automated message and only visible to you.';

function logReport(record) {
  fs.appendFile(REPORTS_FILE, JSON.stringify(record) + '\n', (err) => {
    if (err) console.error('Failed to write report log:', err);
  });
}

// ---- matchmaking state -------------------------------------------------

let waitingQueue = []; // array of socket ids waiting for a partner
const partnerOf = new Map(); // socketId -> partnerSocketId
const roomHistory = new Map(); // socketId -> rolling array of {from, text, ts} for the CURRENT room (both sides' messages)

const RATE_LIMIT_WINDOW_MS = 2000;
const RATE_LIMIT_MAX_MSGS = 6;
const rateState = new Map(); // socketId -> { count, windowStart }

function withinRateLimit(id) {
  const now = Date.now();
  const state = rateState.get(id) || { count: 0, windowStart: now };
  if (now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }
  state.count += 1;
  rateState.set(id, state);
  return state.count <= RATE_LIMIT_MAX_MSGS;
}

function removeFromQueue(id) {
  waitingQueue = waitingQueue.filter((qid) => qid !== id);
}

function tryMatch(id) {
  removeFromQueue(id);
  const candidateId = waitingQueue.shift();
  if (candidateId && io.sockets.sockets.get(candidateId)) {
    partnerOf.set(id, candidateId);
    partnerOf.set(candidateId, id);
    roomHistory.set(id, []);
    roomHistory.set(candidateId, []);
    io.to(id).emit('matched');
    io.to(candidateId).emit('matched');
  } else {
    waitingQueue.push(id);
    io.to(id).emit('queued');
  }
}

function endPairing(id, { notifyPartner = true, reason = 'left' } = {}) {
  const partnerId = partnerOf.get(id);
  partnerOf.delete(id);
  roomHistory.delete(id);
  if (partnerId) {
    partnerOf.delete(partnerId);
    roomHistory.delete(partnerId);
    if (notifyPartner && io.sockets.sockets.get(partnerId)) {
      io.to(partnerId).emit('partner_left', { reason });
    }
  }
  return partnerId;
}

// ---- live stats ---------------------------------------------------------
// Broadcast to everyone connected (even people still on the landing page,
// which stays socket-connected just to receive this) whenever the numbers
// could have changed.

function broadcastStats() {
  io.emit('stats', {
    online: io.engine.clientsCount,
    activeChats: Math.floor(partnerOf.size / 2),
  });
}

io.on('connection', (socket) => {
  const id = socket.id;
  broadcastStats();

  socket.on('join_queue', () => {
    if (partnerOf.has(id)) return; // already paired
    tryMatch(id);
    broadcastStats();
  });

  socket.on('message', (payload) => {
    const partnerId = partnerOf.get(id);
    if (!partnerId) return;

    const raw = typeof payload === 'string' ? payload : payload && payload.text;
    if (!raw || typeof raw !== 'string') return;
    const text = raw.slice(0, 2000).trim();
    if (!text) return;

    if (!withinRateLimit(id)) {
      socket.emit('system', { text: "You're sending messages too fast. Slow down a little." });
      return;
    }

    // Minor disclosure check runs on BOTH participants' messages.
    const minorSignal = mentionsMinorAge(text);
    if (minorSignal !== null) {
      logReport({
        type: 'auto_minor_disclosure',
        ts: new Date().toISOString(),
        socket: id,
        partner: partnerId,
        signal: minorSignal,
        message: text,
      });
      const bothIds = [id, partnerId];
      endPairing(id, { notifyPartner: false });
      bothIds.forEach((sid) => {
        if (io.sockets.sockets.get(sid)) {
          io.to(sid).emit('system', {
            text: 'This chat has been ended. This site is for adults (18+) only, and a message suggested someone in this chat may be under 18.',
          });
          io.to(sid).emit('partner_left', { reason: 'safety' });
        }
      });
      return;
    }

    const clean = filter.clean(text);

    // append to rolling history (both sides), capped at 20 entries
    [id, partnerId].forEach((sid) => {
      const hist = roomHistory.get(sid) || [];
      hist.push({ from: id, text: clean, ts: Date.now() });
      while (hist.length > 20) hist.shift();
      roomHistory.set(sid, hist);
    });

    socket.emit('message', { text: clean, self: true });
    if (io.sockets.sockets.get(partnerId)) {
      io.to(partnerId).emit('message', { text: clean, self: false });
    }

    if (mentionsSelfHarm(text)) {
      socket.emit('system', { text: SELF_HARM_RESPONSE });
    }
  });

  socket.on('skip', () => {
    endPairing(id, { reason: 'skipped' });
    tryMatch(id);
    broadcastStats();
  });

  socket.on('leave', () => {
    endPairing(id, { reason: 'left' });
    removeFromQueue(id);
    broadcastStats();
  });

  socket.on('report', (payload) => {
    const partnerId = partnerOf.get(id);
    const reason = (payload && payload.reason ? String(payload.reason) : 'unspecified').slice(0, 500);
    if (partnerId) {
      logReport({
        type: 'user_report',
        ts: new Date().toISOString(),
        reporter: id,
        reported: partnerId,
        reason,
        recentMessages: roomHistory.get(id) || [],
      });
      endPairing(id, { reason: 'reported' });
    }
    socket.emit('system', { text: 'Report submitted. This chat has ended. Thank you for flagging it.' });
    broadcastStats();
  });

  socket.on('disconnect', () => {
    endPairing(id, { reason: 'disconnected' });
    removeFromQueue(id);
    rateState.delete(id);
    // small delay so io.engine.clientsCount has actually decremented by the
    // time we read it (engine.io tears the transport down slightly after
    // the socket.io "disconnect" event fires)
    setTimeout(broadcastStats, 100);
  });
});

server.listen(PORT, () => {
  console.log(`Random chat server running on http://localhost:${PORT}`);
});

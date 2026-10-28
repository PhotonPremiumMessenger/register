/**
 * NEXO Messenger end-to-end smoke test.
 * Exercises auth, DMs, realtime WS, groups, channels, search, attachments,
 * settings, password reset and the authorization rules — against a running server.
 *
 * Usage:  node scripts/smoke-test.mjs   (BASE_URL env to override http://127.0.0.1:3000)
 */
import { WebSocket } from 'ws';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const R = Date.now().toString(36).slice(-6);

let failures = 0;
let checks = 0;
function check(name, cond, extra = '') {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

function connectWS(token) {
  return new Promise((resolve, reject) => {
    const url = `${BASE.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    const events = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const event = JSON.parse(String(raw));
      events.push(event);
      for (const w of [...waiters]) {
        if (w.pred(event)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(event);
        }
      }
    });
    ws.on('open', () => resolve({
      ws,
      events,
      waitFor(pred, timeout = 5000, label = 'event') {
        const existing = events.find(pred);
        if (existing) return Promise.resolve(existing);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`WS timeout waiting for ${label}`)), timeout);
          waiters.push({
            pred,
            resolve: (e) => {
              clearTimeout(timer);
              res(e);
            },
          });
        });
      },
      send: (obj) => ws.send(JSON.stringify(obj)),
      close: () => ws.close(),
    }));
    ws.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`NEXO smoke test → ${BASE} (run ${R})\n`);

  // ── health & providers ──────────────────────────────────────────────
  console.log('[health]');
  const health = await req('GET', '/api/health');
  check('health endpoint responds', health.status === 200 && health.json.ok === true);
  const providers = await req('GET', '/api/auth/providers');
  check('providers endpoint reports google=false (not configured)', providers.json?.google === false,
    JSON.stringify(providers.json));

  // ── signup / validation ─────────────────────────────────────────────
  console.log('\n[auth]');
  const aliceCred = { email: `alice.${R}@nexo.test`, password: 'wonderland-1', username: `alice_${R}`, display_name: 'Alice Liddell' };
  const bobCred = { email: `bob.${R}@nexo.test`, password: 'builder-123', username: `bob_${R}`, display_name: 'Bob Builder' };
  const carolCred = { email: `carol.${R}@nexo.test`, password: 'carol-secret-1', username: `carol_${R}`, display_name: 'Carol Danvers' };

  const alice = await req('POST', '/api/auth/signup', { body: aliceCred });
  check('alice signs up', alice.status === 201 && Boolean(alice.json?.token), JSON.stringify(alice.json));
  const bob = await req('POST', '/api/auth/signup', { body: bobCred });
  check('bob signs up', bob.status === 201 && Boolean(bob.json?.token));
  const carol = await req('POST', '/api/auth/signup', { body: carolCred });
  check('carol signs up', carol.status === 201 && Boolean(carol.json?.token));

  const dupUsername = await req('POST', '/api/auth/signup', { body: { ...carolCred, email: `x.${R}@nexo.test`, username: aliceCred.username } });
  check('duplicate username rejected (409)', dupUsername.status === 409, JSON.stringify(dupUsername.json));
  const dupEmail = await req('POST', '/api/auth/signup', { body: { ...carolCred, username: `zz_${R}` } });
  check('duplicate email rejected (409)', dupEmail.status === 409);
  const weakPw = await req('POST', '/api/auth/signup', { body: { email: `w.${R}@nexo.test`, password: 'short', username: `w_${R}`, display_name: 'W' } });
  check('weak password rejected (400)', weakPw.status === 400);
  const badUsername = await req('POST', '/api/auth/signup', { body: { email: `bu.${R}@nexo.test`, password: 'longenough1', username: 'a!A', display_name: 'Bad' } });
  check('invalid username rejected (400)', badUsername.status === 400);

  const wrongPw = await req('POST', '/api/auth/signin', { body: { email: aliceCred.email, password: 'nope-nope-1' } });
  check('wrong password → 401', wrongPw.status === 401);
  const signin = await req('POST', '/api/auth/signin', { body: { email: aliceCred.email, password: aliceCred.password } });
  check('alice signs in (persistent session token)', signin.status === 200 && Boolean(signin.json?.token));
  const me = await req('GET', '/api/auth/me', { token: signin.json.token });
  check('GET /me returns profile with unique id + username', me.status === 200 && me.json?.profile?.username === aliceCred.username);
  const noAuth = await req('GET', '/api/chats');
  check('protected route without token → 401', noAuth.status === 401);

  const aT = alice.json.token;
  const bT = bob.json.token;
  const cT = carol.json.token;
  const aId = alice.json.profile.id;
  const bId = bob.json.profile.id;

  // ── profile updates ─────────────────────────────────────────────────
  console.log('\n[profiles]');
  const bioUpdate = await req('PATCH', '/api/users/me', { token: aT, body: { bio: 'Curiouser and curiouser.' } });
  check('alice updates bio', bioUpdate.status === 200 && bioUpdate.json?.profile?.bio === 'Curiouser and curiouser.');
  const clash = await req('PATCH', '/api/users/me', { token: bT, body: { username: aliceCred.username } });
  check('bob cannot take alice\'s username (409)', clash.status === 409);
  const byName = await req('GET', `/api/users/by-username/${aliceCred.username}`, { token: bT });
  check('lookup by username works', byName.status === 200 && byName.json?.profile?.id === aId);

  // ── direct messages + realtime ──────────────────────────────────────
  console.log('\n[dm + realtime]');
  const bobWS = await connectWS(bT);
  const welcome = await bobWS.waitFor((e) => e.type === 'welcome', 5000, 'welcome');
  check('bob WS welcome includes online users', Array.isArray(welcome.online));

  const aliceWS = await connectWS(aT);
  await aliceWS.waitFor((e) => e.type === 'welcome', 5000, 'alice welcome');
  const presence = await bobWS.waitFor((e) => e.type === 'presence' && e.user_id === aId && e.online === true, 5000, 'alice presence');
  check('alice joining broadcasts presence to bob', Boolean(presence));

  const chatRes = await req('POST', '/api/chats', { token: aT, body: { user_id: bId } });
  check('alice opens DM with bob', chatRes.status === 201 || chatRes.status === 200, JSON.stringify(chatRes.json));
  const convId = chatRes.json?.conversation?.id;

  const msgPromise = bobWS.waitFor((e) => e.type === 'message' && e.message?.conversation_id === convId, 6000, 'dm message');
  const sent = await req('POST', `/api/chats/${convId}/messages`, { token: aT, body: { content: 'Hello Bob! 🌙' } });
  check('alice sends a message (stored)', sent.status === 201 && Boolean(sent.json?.message?.id));
  const received = await msgPromise;
  check('bob receives it in realtime', received.message.content === 'Hello Bob! 🌙');
  check('message carries sender info', received.message.sender?.username === aliceCred.username);

  const bobChats = await req('GET', '/api/chats', { token: bT });
  check('bob conversation list shows unread=1', bobChats.json?.conversations?.[0]?.unread_count === 1, JSON.stringify(bobChats.json?.conversations?.[0]?.unread_count));

  const readPromise = aliceWS.waitFor((e) => e.type === 'read' && e.chat_id === convId && e.user_id === bId, 6000, 'read receipt');
  await req('POST', `/api/chats/${convId}/read`, { token: bT });
  const readEvt = await readPromise;
  check('read receipt broadcast to alice', Boolean(readEvt.at));

  // typing indicator (throttled relay)
  const typingPromise = bobWS.waitFor((e) => e.type === 'typing' && e.chat_id === convId && e.is_typing === true, 6000, 'typing');
  aliceWS.send({ type: 'typing', chat_type: 'dm', chat_id: convId, is_typing: true });
  const typingEvt = await typingPromise;
  check('typing indicator relayed to bob', typingEvt.user_id === aId);

  // DM policy: carol blocks messages
  await req('PATCH', '/api/settings', { token: cT, body: { allow_messages_from: 'nobody' } });
  const blocked = await req('POST', '/api/chats', { token: aT, body: { user_id: carol.json.profile.id } });
  check('DM blocked when recipient disallows messages (403)', blocked.status === 403);
  await req('PATCH', '/api/settings', { token: cT, body: { allow_messages_from: 'everyone' } });

  // ── security: conversation privacy ─────────────────────────────────
  console.log('\n[security]');
  const carolPeek = await req('GET', `/api/chats/${convId}/messages`, { token: cT });
  check('carol cannot read alice↔bob messages (403)', carolPeek.status === 403);
  const carolDetail = await req('GET', `/api/chats/${convId}`, { token: cT });
  check('carol cannot open the conversation (403)', carolDetail.status === 403);
  const carolSend = await req('POST', `/api/chats/${convId}/messages`, { token: cT, body: { content: 'intruder' } });
  check('carol cannot post into it (403)', carolSend.status === 403);

  // ── groups ──────────────────────────────────────────────────────────
  console.log('\n[groups]');
  const group = await req('POST', '/api/groups', { token: aT, body: { name: `Wonder Crew ${R}`, description: 'Tea party', is_public: true, member_ids: [bId] } });
  check('alice creates a group with bob', group.status === 201, JSON.stringify(group.json));
  const gId = group.json?.group?.id;

  const gmsgP = bobWS.waitFor((e) => e.type === 'message' && e.message?.group_id === gId, 6000, 'group message');
  const gmsg = await req('POST', `/api/groups/${gId}/messages`, { token: aT, body: { content: 'Meeting at 6pm' } });
  check('alice posts a group message', gmsg.status === 201);
  const grecv = await gmsgP;
  check('bob receives group message in realtime', grecv.message.content === 'Meeting at 6pm');
  check('group message includes sender name', grecv.message.sender?.display_name === 'Alice Liddell');

  const members = await req('GET', `/api/groups/${gId}/members`, { token: bT });
  check('member list shows owner + member roles', members.json?.members?.length === 2 && members.json.members.some((m) => m.role === 'owner'));

  const bobAdds = await req('POST', `/api/groups/${gId}/members`, { token: bT, body: { user_ids: [carol.json.profile.id] } });
  check('plain member cannot add members (403)', bobAdds.status === 403);
  const aliceAdds = await req('POST', `/api/groups/${gId}/members`, { token: aT, body: { user_ids: [carol.json.profile.id] } });
  check('owner adds carol', aliceAdds.status === 200);

  const bobPromotes = await req('PATCH', `/api/groups/${gId}/members/${carol.json.profile.id}`, { token: bT, body: { role: 'admin' } });
  check('member cannot grant admin (403)', bobPromotes.status === 403);
  const carolSelfPromotes = await req('PATCH', `/api/groups/${gId}/members/${carol.json.profile.id}`, { token: cT, body: { role: 'owner' } });
  check('user cannot self-promote to owner (403)', carolSelfPromotes.status === 403);

  const promote = await req('PATCH', `/api/groups/${gId}/members/${carol.json.profile.id}`, { token: aT, body: { role: 'admin' } });
  check('owner promotes carol to admin', promote.status === 200);
  const adminKickFail = await req('DELETE', `/api/groups/${gId}/members/${aId}`, { token: cT });
  check('admin cannot remove the owner (403)', adminKickFail.status === 403);

  // private group access
  const priv = await req('POST', '/api/groups', { token: aT, body: { name: `Secret Club ${R}`, is_public: false } });
  const privId = priv.json?.group?.id;
  const carolPriv = await req('GET', `/api/groups/${privId}`, { token: cT });
  check('non-member cannot access private group (403)', carolPriv.status === 403);
  const carolPrivMsgs = await req('GET', `/api/groups/${privId}/messages`, { token: cT });
  check('non-member cannot read private group messages (403)', carolPrivMsgs.status === 403);
  const carolJoinPriv = await req('POST', `/api/groups/${privId}/join`, { token: cT });
  check('cannot self-join a private group (403)', carolJoinPriv.status === 403);
  const carolJoinPub = await req('POST', `/api/groups/${gId}/join`, { token: cT });
  check('carol is already a member (join is idempotent)', carolJoinPub.status === 200);

  const leave = await req('DELETE', `/api/groups/${gId}/members/${bId}`, { token: bT });
  check('bob leaves the group', leave.status === 200 && leave.json?.left === true);
  const bobMsgAfterLeave = await req('POST', `/api/groups/${gId}/messages`, { token: bT, body: { content: 'let me in' } });
  check('bob cannot post after leaving (403)', bobMsgAfterLeave.status === 403);
  // rejoin via public join for later tests
  await req('POST', `/api/groups/${gId}/join`, { token: bT });

  // ── channels ────────────────────────────────────────────────────────
  console.log('\n[channels]');
  const channel = await req('POST', '/api/channels', { token: bT, body: { name: `Bob News ${R}`, description: 'Broadcasts', is_public: true } });
  check('bob creates a public channel', channel.status === 201);
  const chId = channel.json?.channel?.id;

  const aliceSub = await req('POST', `/api/channels/${chId}/subscribe`, { token: aT });
  check('alice subscribes to the public channel', aliceSub.status === 200 && aliceSub.json?.channel?.subscriber_count === 2);

  const alicePost = await req('POST', `/api/channels/${chId}/posts`, { token: aT, body: { content: 'subscriber post' } });
  check('subscriber CANNOT publish (403, enforced server-side)', alicePost.status === 403);
  const postP = aliceWS.waitFor((e) => e.type === 'post' && e.post?.channel_id === chId, 6000, 'channel post');
  const bobPost = await req('POST', `/api/channels/${chId}/posts`, { token: bT, body: { content: 'Channel launch 🚀' } });
  check('owner publishes a post', bobPost.status === 201);
  const postRecv = await postP;
  check('subscriber receives the post in realtime', postRecv.post.content === 'Channel launch 🚀');

  const grantAdmin = await req('PATCH', `/api/channels/${chId}/members/${aId}`, { token: bT, body: { role: 'admin' } });
  check('owner grants alice publishing rights (admin)', grantAdmin.status === 200);
  const alicePost2 = await req('POST', `/api/channels/${chId}/posts`, { token: aT, body: { content: 'Now I can post' } });
  check('admin can now publish', alicePost2.status === 201);

  const privCh = await req('POST', '/api/channels', { token: aT, body: { name: `Alice Private ${R}`, is_public: false } });
  const privChId = privCh.json?.channel?.id;
  const carolSubPriv = await req('POST', `/api/channels/${privChId}/subscribe`, { token: cT });
  check('cannot subscribe to a private channel (403)', carolSubPriv.status === 403);
  const carolAddPriv = await req('POST', `/api/channels/${privChId}/members`, { token: aT, body: { user_ids: [carol.json.profile.id] } });
  check('owner adds carol to private channel', carolAddPriv.status === 200);
  const carolReadPriv = await req('GET', `/api/channels/${privChId}/posts`, { token: cT });
  check('added member can read private channel', carolReadPriv.status === 200);

  const unsub = await req('DELETE', `/api/channels/${chId}/subscribe`, { token: aT });
  check('alice unsubscribes', unsub.status === 200);
  const unsubOwner = await req('DELETE', `/api/channels/${chId}/subscribe`, { token: bT });
  check('owner cannot unsubscribe from own channel (400)', unsubOwner.status === 400);
  await req('POST', `/api/channels/${chId}/subscribe`, { token: aT }); // restore for attachment test

  // ── search ──────────────────────────────────────────────────────────
  console.log('\n[search]');
  const sPeople = await req('GET', `/api/search?q=alice_${R}&scope=people`, { token: bT });
  check('search finds people by username', sPeople.json?.people?.some((p) => p.username === aliceCred.username));
  const sGroups = await req('GET', `/api/search?q=wonder&scope=groups`, { token: bT });
  check('search finds public groups by name', sGroups.json?.groups?.some((g) => g.id === gId));
  const sChannels = await req('GET', `/api/search?q=bob news&scope=channels`, { token: aT });
  check('search finds public channels by name', sChannels.json?.channels?.some((c) => c.id === chId));
  const sPriv = await req('GET', `/api/search?q=secret club&scope=groups`, { token: cT });
  check('private groups are not exposed to non-members', !sPriv.json?.groups?.some((g) => g.id === privId));
  const sEmpty = await req('GET', `/api/search?q=zzz-nothing-${R}`, { token: bT });
  check('empty search returns empty arrays', sEmpty.json?.people?.length === 0 && sEmpty.json?.groups?.length === 0);

  // ── attachments ─────────────────────────────────────────────────────
  console.log('\n[attachments]');
  const pngPath = join(tmpdir(), `nexo-test-${R}.png`);
  // 1x1 red pixel PNG
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  writeFileSync(pngPath, Buffer.from(pngB64, 'base64'));

  const form = new FormData();
  form.append('kind', 'message');
  const blob = new Blob([Buffer.from(pngB64, 'base64')], { type: 'image/png' });
  form.append('file', blob, 'pixel.png');
  const upload = await req('POST', '/api/attachments', { token: aT, form });
  check('alice uploads a PNG', upload.status === 201 && upload.json?.attachment?.mime_type === 'image/png', JSON.stringify(upload.json));
  const attId = upload.json?.attachment?.id;

  const badForm = new FormData();
  badForm.append('kind', 'message');
  badForm.append('file', new Blob(['#!/bin/sh'], { type: 'application/x-sh' }), 'evil.sh');
  const badUpload = await req('POST', '/api/attachments', { token: aT, form: badForm });
  check('disallowed file type rejected (415)', badUpload.status === 415, JSON.stringify(badUpload.json));

  const msgWithAtt = await req('POST', `/api/chats/${convId}/messages`, { token: aT, body: { content: 'look at this', attachment_id: attId } });
  check('message with attachment sent', msgWithAtt.status === 201 && msgWithAtt.json?.message?.attachment?.id === attId);
  const bobDl = await req('GET', `/api/attachments/${attId}/file`, { token: bT });
  check('bob (participant) can download it', bobDl.status === 200 && bobDl.headers.get('content-type') === 'image/png');
  const carolDl = await req('GET', `/api/attachments/${attId}/file`, { token: cT });
  check('carol (non-participant) is denied (403)', carolDl.status === 403);
  const anonDl = await fetch(`${BASE}/api/attachments/${attId}/file`);
  check('anonymous download denied (401)', anonDl.status === 401);

  // avatar upload + profile persistence
  const avatarForm = new FormData();
  avatarForm.append('kind', 'avatar');
  avatarForm.append('file', new Blob([Buffer.from(pngB64, 'base64')], { type: 'image/png' }), 'avatar.png');
  const avatarUp = await req('POST', '/api/attachments', { token: aT, form: avatarForm });
  check('avatar upload (kind=avatar)', avatarUp.status === 201);
  const setAvatar = await req('PATCH', '/api/users/me', { token: aT, body: { avatar_attachment_id: avatarUp.json?.attachment?.id } });
  check('avatar attached to profile (persisted)', setAvatar.json?.profile?.avatar_attachment_id === avatarUp.json?.attachment?.id);
  const bobSeesAvatar = await req('GET', `/api/users/${aId}`, { token: bT });
  check('avatar visible to other users', bobSeesAvatar.json?.profile?.avatar_attachment_id === avatarUp.json?.attachment?.id);
  const stealAvatar = await req('PATCH', '/api/users/me', { token: bT, body: { avatar_attachment_id: attId } });
  check('cannot use someone else\'s attachment as avatar (400)', stealAvatar.status === 400);

  unlinkSync(pngPath);

  // ── settings & presence privacy ─────────────────────────────────────
  console.log('\n[settings + presence]');
  const themeRes = await req('PATCH', '/api/settings', { token: bT, body: { theme: 'midnight' } });
  check('theme saved to DB', themeRes.json?.settings?.theme === 'midnight');
  const badTheme = await req('PATCH', '/api/settings', { token: bT, body: { theme: 'hot-pink' } });
  check('invalid theme rejected (400)', badTheme.status === 400);
  await req('PATCH', '/api/settings', { token: bT, body: { theme: 'obsidian' } });

  await req('PATCH', '/api/settings', { token: aT, body: { show_online_status: false } });
  aliceWS.close();
  await sleep(400);
  const aliceWS2 = await connectWS(aT); // reconnect while hidden
  const carolWS = await connectWS(cT);
  const carolWelcome = await carolWS.waitFor((e) => e.type === 'welcome', 5000, 'carol welcome');
  check('hidden user absent from online list', !carolWelcome.online.includes(aId), JSON.stringify(carolWelcome.online));
  const bobWelcome2 = await (async () => {
    bobWS.close();
    await sleep(300);
    const ws2 = await connectWS(bT);
    return ws2.waitFor((e) => e.type === 'welcome', 5000, 'bob welcome 2');
  })();
  check('alice (hidden) not shown online to bob either', !bobWelcome2.online.includes(aId));
  await req('PATCH', '/api/settings', { token: aT, body: { show_online_status: true } });
  aliceWS2.close();
  carolWS.close();

  // ── persistence across reconnect ────────────────────────────────────
  console.log('\n[persistence]');
  const freshSignin = await req('POST', '/api/auth/signin', { body: { email: aliceCred.email, password: aliceCred.password } });
  const freshChats = await req('GET', '/api/chats', { token: freshSignin.json.token });
  check('conversations persist for a fresh session', freshChats.json?.conversations?.some((c) => c.id === convId));
  const freshMsgs = await req('GET', `/api/chats/${convId}/messages`, { token: freshSignin.json.token });
  check('messages persist in the database', freshMsgs.json?.messages?.length >= 2);

  // ── password reset (dev mode: link returned, no SMTP) ───────────────
  console.log('\n[password reset]');
  const forgot = await req('POST', '/api/auth/forgot', { body: { email: carolCred.email } });
  check('forgot-password returns dev reset link (no SMTP configured)', forgot.status === 200 && Boolean(forgot.json?.dev_reset_url), JSON.stringify(forgot.json));
  const resetToken = new URL(forgot.json.dev_reset_url).searchParams.get('token');
  const reset = await req('POST', '/api/auth/reset', { body: { token: resetToken, password: 'brand-new-pass-1' } });
  check('password reset succeeds', reset.status === 200 && reset.json?.ok === true);
  const oldPwSignin = await req('POST', '/api/auth/signin', { body: { email: carolCred.email, password: carolCred.password } });
  check('old password no longer works (401)', oldPwSignin.status === 401);
  const newPwSignin = await req('POST', '/api/auth/signin', { body: { email: carolCred.email, password: 'brand-new-pass-1' } });
  check('new password works', newPwSignin.status === 200);
  const badTokenReset = await req('POST', '/api/auth/reset', { body: { token: 'garbage', password: 'whatever-123' } });
  check('invalid reset token rejected (400)', badTokenReset.status === 400);
  const forgotUnknown = await req('POST', '/api/auth/forgot', { body: { email: `nobody-${R}@nexo.test` } });
  check('unknown email → generic response, no link', forgotUnknown.status === 200 && forgotUnknown.json?.dev_reset_url === null);

  // ── google oauth honesty ────────────────────────────────────────────
  console.log('\n[google oauth]');
  const googleRes = await fetch(`${BASE}/api/auth/google`, { redirect: 'manual' });
  check('GET /api/auth/google → 501 with configuration guidance (not faked)', googleRes.status === 501);

  bobWS.close();
  await sleep(200);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} FAILURES`);
    process.exit(1);
  }
  console.log('ALL GREEN ✅');
  process.exit(0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(2);
});

// ════════════════════════════════════════════════
// firebase-db.js — Firebase Realtime Database adapter for An II (v25 dictfix)
// Совместимый слой вместо старого supabase.js.
// Цель: не переписывать весь проект за один заход, а дать тем же импортам
// работать поверх Firebase.
// ════════════════════════════════════════════════
import { toDateStr } from './utils.js';

export const ADMIN_USERNAME = globalThis.AN2_ADMIN_USERNAME || 'boikot5225';

// Старые Supabase Edge Functions пока оставлены только для AI/TTS.
// Данные, вход, SRS, статистика и справочники идут через Firebase.
export const SUPABASE_URL = 'https://dhimxbkjvowmwrosgcpb.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_8H-4I4IDKQG_Vr-FBZ7ESQ_ZH5PSHZv';

export const REQUEST_TIMEOUT_MS = 60000;
export const AUTH_REQUEST_TIMEOUT_MS = 60000;
export const LONG_REQUEST_TIMEOUT_MS = 90000;

const COMPAT_SESSION_KEY = 'sb-dhimxbkjvowmwrosgcpb-auth-token';
const MISSING_CONFIG_MARKERS = ['PASTE_', 'YOUR_', 'example.com'];

export let sb = null;
export let sbUser = null;

let fbApp = null;
let fbAuth = null;
let fbDb = null;
let firebaseReady = false;

function getFirebaseConfig() {
  return globalThis.FIREBASE_CONFIG || null;
}

function looksMissingConfig(config) {
  if (!config || typeof config !== 'object') return true;
  const required = ['apiKey', 'databaseURL', 'projectId', 'appId'];
  return required.some((k) => {
    const v = String(config[k] || '').trim();
    return !v || MISSING_CONFIG_MARKERS.some((m) => v.includes(m));
  });
}

function humanFirebaseError(error) {
  const code = error?.code || '';
  const rawMsg = error?.message || String(error || 'Ошибка Firebase');
  const msg = String(rawMsg);
  const c = String(code).toLowerCase();
  const m = msg.toLowerCase();

  if (c.includes('auth/operation-not-allowed') || m.includes('operation-not-allowed')) {
    return 'Firebase Auth: Email/Password вход выключен. Открой Firebase Console → Authentication → Sign-in method → Email/Password → Enable.';
  }
  if (c.includes('auth/configuration-not-found') || m.includes('configuration-not-found')) {
    return 'Firebase Auth не настроен для проекта. Проверь Authentication → Sign-in method → включён ли Email/Password.';
  }
  if (c.includes('auth/unauthorized-domain') || m.includes('unauthorized-domain')) {
    return 'Домен сайта не разрешён в Firebase Auth. Открой Authentication → Settings → Authorized domains и добавь домен GitHub Pages без https и без пути, например boikot5225-afk.github.io.';
  }
  if (c.includes('auth/invalid-api-key') || m.includes('invalid-api-key')) return 'Firebase: неверный apiKey в js/firebase-config.js.';
  if (c.includes('auth/app-not-authorized') || m.includes('app-not-authorized')) return 'Firebase: приложение не авторизовано. Проверь Firebase config и Authorized domains.';
  if (c.includes('auth/invalid-credential') || c.includes('auth/wrong-password') || c.includes('auth/user-not-found')) return 'Неверный email или пароль.';
  if (c.includes('auth/email-already-in-use')) return 'Такой email уже зарегистрирован. Просто войди через вкладку «Войти».';
  if (c.includes('auth/weak-password')) return 'Пароль слишком слабый. Минимум 6 символов.';
  if (c.includes('auth/invalid-email')) return 'Некорректный email.';
  if (c.includes('auth/network-request-failed') || m.includes('network-request-failed')) return 'Firebase Auth не отвечает по сети. Проверь интернет/VPN/доступ к gstatic, googleapis и firebaseapp.';
  if (c.includes('permission-denied') || m.includes('permission_denied') || m.includes('permission denied')) return 'Firebase Realtime Database отказал в доступе. Проверь Rules и /admins/<UID> = true, если это админская запись.';
  return msg;
}
export async function fetchWithTimeout(input, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(`Сервер не ответил за ${Math.round(timeoutMs / 1000)} сек. Проверь сеть/VPN и попробуй ещё раз.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function mapFirebaseUser(user) {
  if (!user) return null;
  return {
    id: user.uid,
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    firebaseUser: user,
  };
}

async function getIdTokenSafe(forceRefresh = false) {
  const user = fbAuth?.currentUser || null;
  if (!user || typeof user.getIdToken !== 'function') return null;
  try { return await user.getIdToken(forceRefresh); }
  catch { return null; }
}

async function writeCompatSession(user) {
  const mapped = mapFirebaseUser(user);
  if (!mapped) return;
  const token = await getIdTokenSafe(false);
  const payload = {
    currentSession: {
      access_token: token || 'firebase-local-session',
      refresh_token: 'firebase-managed-by-sdk',
      expires_at: 0,
      user: mapped,
    },
  };
  try { localStorage.setItem(COMPAT_SESSION_KEY, JSON.stringify(payload)); }
  catch { /* ignore */ }
}

function clearCompatSession() {
  try { localStorage.removeItem(COMPAT_SESSION_KEY); }
  catch { /* ignore */ }
}

function snapToRows(value, table) {
  if (value == null) return [];

  // stats and srs are stored per user: /stats/{uid}/{key}, /srs/{uid}/{verbId}
  if (table === 'stats') {
    const rows = [];
    Object.entries(value || {}).forEach(([uid, bucket]) => {
      Object.entries(bucket || {}).forEach(([key, item]) => {
        rows.push({ user_id: uid, key, ...(item || {}) });
      });
    });
    return rows;
  }

  if (table === 'srs') {
    const rows = [];
    Object.entries(value || {}).forEach(([uid, bucket]) => {
      Object.entries(bucket || {}).forEach(([verbId, item]) => {
        rows.push({ user_id: uid, verb_id: verbId, ...(item || {}) });
      });
    });
    return rows;
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean).map((row, idx) => ({ id: row?.id ?? String(idx), ...(row || {}) }));
  }

  if (typeof value === 'object') {
    return Object.entries(value).map(([key, row]) => {
      if (row && typeof row === 'object' && !Array.isArray(row)) return { id: row.id ?? key, ...row };
      return { id: key, value: row };
    });
  }

  return [];
}

function normalizeRecordForWrite(table, row) {
  const copy = { ...(row || {}) };
  if (table === 'profiles') {
    copy.id = copy.id || sbUser?.id || sbUser?.uid;
    return copy;
  }
  if (table === 'stats') {
    delete copy.user_id;
    return copy;
  }
  if (table === 'srs') {
    delete copy.user_id;
    return copy;
  }
  if (table === 'meta') {
    delete copy.user_id;
    return copy;
  }
  if (table === 'reader_books') {
    delete copy.user_id;
    return copy;
  }
  return copy;
}

function recordPath(table, row) {
  const uid = row?.user_id || sbUser?.id || sbUser?.uid;
  if (table === 'profiles') return `profiles/${row?.id || uid}`;
  if (table === 'stats') return `stats/${uid}/${row?.key}`;
  if (table === 'srs') return `srs/${uid}/${row?.verb_id || row?.id}`;
  if (table === 'meta') return `meta/${uid}`;
  if (table === 'reader_books') return `reader_books/${uid}/${safeFirebaseKey(row?.id || row?.title || Date.now())}`;
  const key = row?.id || row?.inf || row?.fr;
  if (!key) throw new Error(`Не могу определить ключ записи для ${table}`);
  return `${table}/${safeFirebaseKey(key)}`;
}

function safeFirebaseKey(key) {
  return String(key).replace(/[.#$\[\]/]/g, '_');
}


// v25: убрали автоматический fallback на /Verbs, /Phrases и т.п.
// Иначе после миграции приложение могло показывать старую Supabase-выгрузку,
// если она случайно лежала в Firebase с большой буквы. Источник истины теперь
// только нижний регистр: /verbs, /phrases, /nouns, /prepositions.
const LEGACY_TABLE_ALIASES = {};

async function readTableValue(table) {
  if (!fbDb) throw new Error('Firebase Database не инициализирован');
  const paths = [table, ...(LEGACY_TABLE_ALIASES[table] || [])];
  let firstError = null;

  for (const path of paths) {
    try {
      const snap = await fbDb.ref(path).get();
      if (snap.exists()) {
        if (path !== table) console.warn(`[firebase] using legacy uppercase path /${path}. Лучше переимпортировать данные в /${table}.`);
        return { path, value: snap.val() };
      }
    } catch (e) {
      if (!firstError) firstError = e;
      if (path === table) throw e;
    }
  }

  return { path: table, value: null, error: firstError };
}

function waitForCurrentUserUid(uid, timeoutMs = 8000) {
  if (!fbAuth) return Promise.resolve(null);
  if (fbAuth.currentUser && (!uid || fbAuth.currentUser.uid === uid)) return Promise.resolve(fbAuth.currentUser);
  return new Promise((resolve) => {
    let done = false;
    let unsub = null;
    const finish = (user) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (unsub) unsub(); } catch {}
      resolve(user || null);
    };
    const timer = setTimeout(() => finish(fbAuth.currentUser || null), timeoutMs);
    unsub = fbAuth.onAuthStateChanged((user) => {
      if (!uid || user?.uid === uid) finish(user || null);
    });
  });
}

async function ensureAuthenticatedForPrivatePath(expectedUid = null, timeoutMs = 8000) {
  if (!fbAuth) throw new Error('Firebase Auth не инициализирован');
  const uid = expectedUid || sbUser?.id || sbUser?.uid || null;
  const user = await waitForCurrentUserUid(uid, timeoutMs);
  if (!user) {
    throw new Error('Firebase Auth ещё не подтвердил сессию. Обнови страницу и войди заново.');
  }
  if (uid && user.uid !== uid) {
    throw new Error('Firebase Auth вернул другого пользователя. Выйди и войди заново.');
  }
  if (typeof user.getIdToken === 'function') await user.getIdToken(false);
  sbUser = mapFirebaseUser(user);
  await writeCompatSession(user);
  return user;
}

function tableNeedsAuth(table) {
  return ['profiles', 'stats', 'srs', 'meta', 'reader_books'].includes(table);
}

async function writeProfileBestEffort(user, username, email) {
  if (!fbDb || !user?.uid) return null;
  try {
    if (typeof user.getIdToken === 'function') await user.getIdToken(true);
    await waitForCurrentUserUid(user.uid, 6000);
    const safeUsername = String(username || email?.split('@')[0] || 'user').trim() || 'user';
    await fbDb.ref(`profiles/${user.uid}`).update({
      id: user.uid,
      username: safeUsername,
      email: email || user.email || '',
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    return null;
  } catch (e) {
    console.warn('[firebase] profile write failed but auth account may exist:', e);
    return humanFirebaseError(e);
  }
}

class FirebaseQueryBuilder {
  constructor(table) {
    this.table = table;
    this._op = 'select';
    this._filters = [];
    this._orderField = null;
    this._ascending = true;
    this._range = null;
    this._maybeSingle = false;
    this._head = false;
    this._count = null;
    this._writePayload = null;
  }

  select(_columns = '*', options = {}) {
    this._op = 'select';
    this._head = !!options?.head;
    this._count = options?.count || null;
    return this;
  }

  order(field, opts = {}) {
    this._orderField = field;
    this._ascending = opts?.ascending !== false;
    return this;
  }

  range(from, to) {
    this._range = [Number(from) || 0, Number(to) || 0];
    return this;
  }

  eq(field, value) {
    this._filters.push({ field, value });
    return this;
  }

  maybeSingle() {
    this._maybeSingle = true;
    return this;
  }

  insert(payload) {
    this._op = 'insert';
    this._writePayload = payload;
    return this;
  }

  upsert(payload) {
    this._op = 'upsert';
    this._writePayload = payload;
    return this;
  }

  delete() {
    this._op = 'delete';
    return this;
  }

  async _execute() {
    if (!fbDb) return { data: null, error: new Error('Firebase не инициализирован') };
    try {
      if (this._op === 'insert' || this._op === 'upsert') return await this._executeWrite();
      if (this._op === 'delete') return await this._executeDelete();
      return await this._executeSelect();
    } catch (e) {
      return { data: null, error: new Error(humanFirebaseError(e)) };
    }
  }

  async _executeSelect() {
    const userFilter = this._filters.find((f) => f.field === 'user_id');
    let rows = [];

    // Firebase rules are not SQL filters: reading /stats and then filtering by
    // user_id would be denied for normal users. Read the exact user branch when
    // the old Supabase-style query asks for eq('user_id', uid).
    if (userFilter && ['stats', 'srs', 'meta', 'reader_books'].includes(this.table)) {
      await ensureAuthenticatedForPrivatePath(userFilter.value, 8000);
      const snap = await fbDb.ref(`${this.table}/${userFilter.value}`).get();
      const value = snap.exists() ? snap.val() : null;
      if (this.table === 'meta') {
        rows = value ? [{ user_id: userFilter.value, ...value }] : [];
      } else if (this.table === 'reader_books') {
        rows = Object.entries(value || {}).map(([key, item]) => ({ id: key, user_id: userFilter.value, ...(item || {}) }));
      } else {
        rows = Object.entries(value || {}).map(([key, item]) => {
          if (this.table === 'stats') return { user_id: userFilter.value, key, ...(item || {}) };
          return { user_id: userFilter.value, verb_id: key, ...(item || {}) };
        });
      }
    } else {
      const { value } = await readTableValue(this.table);
      rows = snapToRows(value, this.table);
    }

    for (const f of this._filters) {
      rows = rows.filter((row) => String(row?.[f.field]) === String(f.value));
    }

    if (this._orderField) {
      const field = this._orderField;
      const dir = this._ascending ? 1 : -1;
      rows.sort((a, b) => String(a?.[field] ?? '').localeCompare(String(b?.[field] ?? ''), 'fr') * dir);
    }

    if (this._range) {
      const [from, to] = this._range;
      rows = rows.slice(from, to + 1);
    }

    if (this._head && this._count === 'exact') return { data: null, error: null, count: rows.length };
    if (this._maybeSingle) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }

  async _executeWrite() {
    const rows = Array.isArray(this._writePayload) ? this._writePayload : [this._writePayload];
    const firstRow = rows.find(Boolean) || {};
    const uid = firstRow.user_id || firstRow.id || sbUser?.id || sbUser?.uid || null;
    if (tableNeedsAuth(this.table)) await ensureAuthenticatedForPrivatePath(uid, 8000);
    else if (['verbs', 'phrases', 'nouns', 'prepositions', 'Verbs', 'Phrases', 'Nouns', 'Prepositions'].includes(this.table)) {
      // Public dictionaries are readable by everyone, but writing them requires an authenticated admin in Rules.
      await ensureAuthenticatedForPrivatePath(null, 8000);
    }
    const updates = {};
    for (const row of rows) {
      if (!row) continue;
      const path = recordPath(this.table, row);
      updates[path] = normalizeRecordForWrite(this.table, row);
    }
    if (Object.keys(updates).length) await fbDb.ref().update(updates);
    return { data: Array.isArray(this._writePayload) ? rows : rows[0] || null, error: null };
  }

  async _executeDelete() {
    const uidFilter = this._filters.find((f) => f.field === 'user_id');
    if (['stats', 'srs', 'meta', 'reader_books'].includes(this.table) && uidFilter?.value) {
      await ensureAuthenticatedForPrivatePath(uidFilter.value, 8000);
      await fbDb.ref(`${this.table}/${uidFilter.value}`).remove();
      return { data: null, error: null };
    }

    const { data, error } = await this._executeSelect();
    if (error) throw error;
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    if (tableNeedsAuth(this.table)) await ensureAuthenticatedForPrivatePath(rows[0]?.user_id || rows[0]?.id || sbUser?.id || sbUser?.uid || null, 8000);
    const updates = {};
    for (const row of rows) updates[recordPath(this.table, row)] = null;
    if (Object.keys(updates).length) await fbDb.ref().update(updates);
    return { data: null, error: null };
  }

  then(resolve, reject) { return this._execute().then(resolve, reject); }
  catch(reject) { return this._execute().catch(reject); }
  finally(cb) { return this._execute().finally(cb); }
}

function makeCompatClient() {
  return {
    from(table) { return new FirebaseQueryBuilder(table); },
    auth: {
      async getSession() {
        const user = await waitForCurrentUserUid(null, 4000);
        if (!user) return { data: { session: null }, error: null };
        sbUser = mapFirebaseUser(user);
        const token = await getIdTokenSafe(false);
        await writeCompatSession(user);
        return { data: { session: { user: sbUser, access_token: token || 'firebase-local-session', expires_at: 0 } }, error: null };
      },
      async refreshSession() {
        const user = await waitForCurrentUserUid(sbUser?.id || sbUser?.uid || null, 6000);
        if (!user) return { data: { session: null }, error: null };
        const token = await getIdTokenSafe(true);
        sbUser = mapFirebaseUser(user);
        await writeCompatSession(user);
        return { data: { session: { user: sbUser, access_token: token || 'firebase-local-session', expires_at: 0 } }, error: null };
      },
      async setSession() {
        // Firebase SDK сам хранит сессию. Оставлено для совместимости со старым кодом.
        const user = fbAuth?.currentUser || null;
        if (user) {
          sbUser = mapFirebaseUser(user);
          await writeCompatSession(user);
        }
        return { data: { user: sbUser }, error: null };
      },
      async signOut() {
        await fbAuth?.signOut();
        sbUser = null;
        clearCompatSession();
        return { error: null };
      },
      async signUp({ email, password, options }) {
        const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
        if (typeof cred.user?.getIdToken === 'function') await cred.user.getIdToken(true);
        await waitForCurrentUserUid(cred.user.uid, 6000);
        sbUser = mapFirebaseUser(cred.user);
        const profileError = await writeProfileBestEffort(cred.user, options?.data?.username, email);
        await writeCompatSession(cred.user);
        if (profileError) sbUser.profileWriteError = profileError;
        return { data: { user: sbUser }, error: null };
      },
    },
  };
}

export function initSupabase() {
  try {
    const config = getFirebaseConfig();
    if (looksMissingConfig(config)) {
      console.error('[firebase] config is missing. Edit js/firebase-config.js');
      firebaseReady = false;
      sb = null;
      return false;
    }
    if (!globalThis.firebase) {
      console.error('[firebase] SDK is not loaded');
      firebaseReady = false;
      sb = null;
      return false;
    }

    if (!globalThis.firebase.apps.length) fbApp = globalThis.firebase.initializeApp(config);
    else fbApp = globalThis.firebase.app();

    fbAuth = globalThis.firebase.auth();
    fbDb = globalThis.firebase.database();

    try { fbAuth.setPersistence(globalThis.firebase.auth.Auth.Persistence.LOCAL); }
    catch { /* not fatal */ }

    fbAuth.onAuthStateChanged((user) => {
      sbUser = mapFirebaseUser(user);
      if (user) writeCompatSession(user).catch(() => {});
      else clearCompatSession();
    });

    sb = makeCompatClient();
    firebaseReady = true;

    globalThis.an2FirebaseHealth = async function an2FirebaseHealth() {
      if (!fbDb) throw new Error('Firebase Database не инициализирован');
      const t0 = Date.now();
      await fbDb.ref('.info/connected').get();
      return { ok: true, ms: Date.now() - t0, databaseURL: config.databaseURL, uid: fbAuth.currentUser?.uid || null };
    };

    globalThis.an2FirebaseWriteSmoke = async function an2FirebaseWriteSmoke() {
      const user = await ensureAuthenticatedForPrivatePath(null, 8000);
      const now = new Date().toISOString();
      const updates = {};
      updates[`meta/${user.uid}/_smoke_last`] = now;
      updates[`stats/${user.uid}/_smoke`] = { total: 1, correct: 1, updated_at: now };
      updates[`srs/${user.uid}/_smoke`] = { interval: 1, ease_factor: 2.5, repetitions: 1, due_date: toDateStr(new Date()), last_review: toDateStr(new Date()), marked_known: false, updated_at: now };
      await fbDb.ref().update(updates);
      return { ok: true, uid: user.uid, paths: Object.keys(updates) };
    };

    return true;
  } catch (e) {
    console.error('[firebase] init failed:', e);
    firebaseReady = false;
    sb = null;
    return false;
  }
}

export function isSupabaseReady() { return firebaseReady && !!sb && !!fbDb; }
export function setSbUser(user) { sbUser = user ? { id: user.id || user.uid, uid: user.uid || user.id, email: user.email || '', ...user } : null; }

export function sbGetCurrentUserId() { return fbAuth?.currentUser?.uid || sbUser?.uid || sbUser?.id || null; }

export async function sbIsCurrentUserAdmin() {
  if (!fbDb || !fbAuth) return false;
  const user = await waitForCurrentUserUid(null, 4000);
  if (!user?.uid) return false;
  try {
    const snap = await fbDb.ref(`admins/${user.uid}`).get();
    return snap.exists() && snap.val() === true;
  } catch (e) {
    console.warn('[firebase] admin check failed:', humanFirebaseError(e));
    return false;
  }
}

export async function sbSignUp(email, password, username) {
  if (!fbAuth || !fbDb) throw new Error('Firebase не загрузился. Проверь js/firebase-config.js и интернет.');
  try {
    const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
    if (typeof cred.user?.getIdToken === 'function') await cred.user.getIdToken(true);
    await waitForCurrentUserUid(cred.user.uid, 6000);
    sbUser = mapFirebaseUser(cred.user);
    const profileError = await writeProfileBestEffort(cred.user, username, email);
    await writeCompatSession(cred.user);
    if (profileError) sbUser.profileWriteError = profileError;
    return sbUser;
  } catch (e) {
    throw new Error(humanFirebaseError(e));
  }
}

export async function sbSignIn(email, password) {
  if (!fbAuth || !fbDb) throw new Error('Firebase не загрузился. Проверь js/firebase-config.js и интернет.');
  try {
    const cred = await fbAuth.signInWithEmailAndPassword(email, password);
    if (typeof cred.user?.getIdToken === 'function') await cred.user.getIdToken(false);
    await waitForCurrentUserUid(cred.user.uid, 6000);
    sbUser = mapFirebaseUser(cred.user);
    await writeCompatSession(cred.user);
    return sbUser;
  } catch (e) {
    throw new Error(humanFirebaseError(e));
  }
}

export async function sbSignOut() {
  try { await fbAuth?.signOut(); }
  finally { sbUser = null; clearCompatSession(); }
}

export async function sbGetProfile() {
  if (!fbDb || !sbUser) return null;
  try {
    const user = await ensureAuthenticatedForPrivatePath(sbUser.id, 8000);
    const snap = await fbDb.ref(`profiles/${user.uid}`).get();
    return snap.exists() ? snap.val() : null;
  } catch (e) {
    console.warn('[firebase] profile load failed:', humanFirebaseError(e));
    return null;
  }
}

export async function sbSaveStats(stats) {
  if (!fbDb || !sbUser) return;
  const user = await ensureAuthenticatedForPrivatePath(sbUser.id, 8000);
  const updates = {};
  Object.entries(stats || {}).forEach(([key, v]) => {
    updates[`stats/${user.uid}/${safeFirebaseKey(key)}`] = { total: v.total || 0, correct: v.correct || 0, updated_at: new Date().toISOString() };
  });
  if (Object.keys(updates).length) await fbDb.ref().update(updates);
}

export async function sbLoadStats() {
  if (!fbDb || !sbUser) return null;
  try {
    const user = await ensureAuthenticatedForPrivatePath(sbUser.id, 8000);
    const snap = await fbDb.ref(`stats/${user.uid}`).get();
    return snap.exists() ? snap.val() : {};
  } catch (e) {
    console.warn('[firebase] stats load failed:', humanFirebaseError(e));
    return null;
  }
}

export async function sbSaveSRS(srs) {
  if (!fbDb || !sbUser) return;
  const user = await ensureAuthenticatedForPrivatePath(sbUser.id, 8000);
  const updates = {};
  Object.entries(srs || {}).forEach(([verbId, c]) => {
    updates[`srs/${user.uid}/${safeFirebaseKey(verbId)}`] = {
      interval: c.interval,
      ease_factor: c.easeFactor,
      repetitions: c.repetitions,
      due_date: toDateStr(c.dueDate),
      last_review: toDateStr(c.lastReview),
      marked_known: c.markedKnown || false,
      updated_at: new Date().toISOString(),
    };
  });
  if (Object.keys(updates).length) await fbDb.ref().update(updates);
}

export async function sbLoadSRS() {
  if (!fbDb || !sbUser) return null;
  try {
    const user = await ensureAuthenticatedForPrivatePath(sbUser.id, 8000);
    const snap = await fbDb.ref(`srs/${user.uid}`).get();
    const data = snap.exists() ? snap.val() : {};
    const srs = {};
    Object.entries(data || {}).forEach(([verbId, r]) => {
      srs[verbId] = {
        interval: r.interval,
        easeFactor: r.ease_factor ?? r.easeFactor,
        repetitions: r.repetitions,
        dueDate: toDateStr(r.due_date ?? r.dueDate),
        lastReview: toDateStr(r.last_review ?? r.lastReview),
        markedKnown: r.marked_known ?? r.markedKnown ?? false,
      };
    });
    return srs;
  } catch (e) {
    console.warn('[firebase] SRS load failed:', humanFirebaseError(e));
    return null;
  }
}

export async function sbSaveMeta(meta) {
  if (!fbDb || !sbUser) return;
  const user = await ensureAuthenticatedForPrivatePath(sbUser.id, 8000);
  await fbDb.ref(`meta/${user.uid}`).update({ ...(meta || {}), updated_at: new Date().toISOString() });
}

export async function sbLoadMeta() {
  if (!fbDb || !sbUser) return null;
  try {
    const user = await ensureAuthenticatedForPrivatePath(sbUser.id, 8000);
    const snap = await fbDb.ref(`meta/${user.uid}`).get();
    return snap.exists() ? snap.val() : null;
  } catch (e) {
    console.warn('[firebase] meta load failed:', humanFirebaseError(e));
    return null;
  }
}

export async function fbLoadTable(table, orderField = null) {
  if (!fbDb) throw new Error('Firebase не инициализирован');
  const { value } = await readTableValue(table);
  let rows = snapToRows(value, table);
  if (orderField) rows.sort((a, b) => String(a?.[orderField] || '').localeCompare(String(b?.[orderField] || ''), 'fr'));
  return rows;
}

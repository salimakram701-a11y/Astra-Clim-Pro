/**
 * Astra Clim Pro — serveur autonome (Node.js 24+)
 * Aucun paquet npm requis. Les données sont conservées dans data/astra-clim.sqlite.
 */
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const scrypt = promisify(scryptCallback);
const APP_ROOT = resolve(import.meta.dirname);
const PUBLIC_ROOT = join(APP_ROOT, 'public');
const DATA_ROOT = join(APP_ROOT, 'data');
const PORT = Number(process.env.PORT || 8787);
const TOKEN_SECRET = process.env.ASTRA_TOKEN_SECRET || 'changez-cette-cle-secrete-avant-mise-en-production';

await mkdir(DATA_ROOT, { recursive: true });
const database = new DatabaseSync(join(DATA_ROOT, 'astra-clim.sqlite'));
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS organisations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    organisation_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon'
};

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin'
  });
  response.end(JSON.stringify(body));
}

function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id, org: user.organisation_id, name: user.name, role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 12
  })).toString('base64url');
  const signature = createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function userFromToken(request) {
  const header = request.headers.authorization || '';
  const [kind, token] = header.split(' ');
  if (kind !== 'Bearer' || !token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.exp > Date.now() ? parsed : null;
  } catch { return null; }
}

async function passwordHash(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString('base64url')}`;
}

async function verifyPassword(password, stored) {
  const [method, salt, expected] = stored.split('$');
  if (method !== 'scrypt' || !salt || !expected) return false;
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const target = Buffer.from(expected, 'base64url');
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function publicUser(user) {
  return { id: user.id, organisationId: user.organisation_id, name: user.name, email: user.email, role: user.role };
}

function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')); }
function cleanString(value, max = 5000) { return String(value || '').trim().slice(0, max); }

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 15 * 1024 * 1024) throw new Error('La requête est trop volumineuse (15 Mo maximum).');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('Le contenu JSON est invalide.'); }
}

function defaultSnapshot() {
  return { schema: 2, clients: [], equipment: [], jobs: [], documents: [], stock: [], technicians: [], settings: {} };
}

async function api(request, response, url) {
  const path = url.pathname;
  if (request.method === 'POST' && path === '/api/auth/bootstrap') {
    const exists = database.prepare('SELECT id FROM users LIMIT 1').get();
    if (exists) return json(response, 409, { error: 'Un espace existe déjà. Utilisez la connexion.' });
    const body = await readBody(request);
    const organisation = cleanString(body.organisation, 120);
    const name = cleanString(body.name, 120);
    const email = cleanString(body.email, 190).toLowerCase();
    const password = String(body.password || '');
    if (!organisation || !name || !validEmail(email) || password.length < 10) {
      return json(response, 400, { error: 'Renseignez l’entreprise, votre nom, un e-mail valide et un mot de passe d’au moins 10 caractères.' });
    }
    const orgId = randomUUID(), userId = randomUUID(), now = new Date().toISOString();
    const passwordHashValue = await passwordHash(password);
    database.prepare('INSERT INTO organisations VALUES (?, ?, ?)').run(orgId, organisation, now);
    database.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run(userId, orgId, name, email, passwordHashValue, 'Administrateur', now);
    database.prepare('INSERT INTO snapshots VALUES (?, 0, ?, ?)').run(orgId, JSON.stringify(defaultSnapshot()), now);
    const user = database.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return json(response, 201, { token: tokenFor(user), user: publicUser(user), organisation: { id: orgId, name: organisation } });
  }

  if (request.method === 'POST' && path === '/api/auth/login') {
    const body = await readBody(request);
    const email = cleanString(body.email, 190).toLowerCase();
    const password = String(body.password || '');
    const user = database.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) return json(response, 401, { error: 'Identifiants incorrects.' });
    const organisation = database.prepare('SELECT id, name FROM organisations WHERE id = ?').get(user.organisation_id);
    return json(response, 200, { token: tokenFor(user), user: publicUser(user), organisation });
  }

  const session = userFromToken(request);
  if (!session) return json(response, 401, { error: 'Session absente ou expirée.' });
  const user = database.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(session.sub);
  if (!user) return json(response, 401, { error: 'Compte introuvable ou désactivé.' });

  if (request.method === 'GET' && path === '/api/auth/me') {
    const organisation = database.prepare('SELECT id, name FROM organisations WHERE id = ?').get(user.organisation_id);
    return json(response, 200, { user: publicUser(user), organisation });
  }
  if (request.method === 'GET' && path === '/api/snapshot') {
    const snapshot = database.prepare('SELECT revision, payload, updated_at FROM snapshots WHERE organisation_id = ?').get(user.organisation_id);
    return json(response, 200, { revision: snapshot.revision, updatedAt: snapshot.updated_at, data: JSON.parse(snapshot.payload) });
  }
  if (request.method === 'PUT' && path === '/api/snapshot') {
    const body = await readBody(request);
    if (!body.data || typeof body.data !== 'object') return json(response, 400, { error: 'Données de synchronisation manquantes.' });
    const snapshot = database.prepare('SELECT revision FROM snapshots WHERE organisation_id = ?').get(user.organisation_id);
    const expectedRevision = Number(body.revision);
    if (Number.isFinite(expectedRevision) && expectedRevision !== snapshot.revision) {
      return json(response, 409, { error: 'Conflit : une autre personne a modifié les données.', revision: snapshot.revision });
    }
    const payload = JSON.stringify(body.data);
    if (Buffer.byteLength(payload) > 14 * 1024 * 1024) return json(response, 413, { error: 'Les données, photos incluses, dépassent 14 Mo.' });
    const newRevision = snapshot.revision + 1, now = new Date().toISOString();
    database.prepare('UPDATE snapshots SET revision = ?, payload = ?, updated_at = ? WHERE organisation_id = ?').run(newRevision, payload, now, user.organisation_id);
    return json(response, 200, { revision: newRevision, updatedAt: now });
  }
  if (request.method === 'POST' && path === '/api/users') {
    if (user.role !== 'Administrateur') return json(response, 403, { error: 'Réservé à l’administrateur.' });
    const body = await readBody(request);
    const name = cleanString(body.name, 120), email = cleanString(body.email, 190).toLowerCase();
    const password = String(body.password || ''), role = cleanString(body.role, 40) || 'Technicien';
    if (!name || !validEmail(email) || password.length < 10) return json(response, 400, { error: 'Nom, e-mail et mot de passe (10 caractères minimum) requis.' });
    try {
      const id = randomUUID(), now = new Date().toISOString();
      database.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run(id, user.organisation_id, name, email, await passwordHash(password), role, now);
      return json(response, 201, { user: { id, name, email, role } });
    } catch { return json(response, 409, { error: 'Cet e-mail est déjà utilisé.' }); }
  }
  return json(response, 404, { error: 'Route introuvable.' });
}

async function staticFile(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const candidate = resolve(PUBLIC_ROOT, `.${requested}`);
  if (!candidate.startsWith(PUBLIC_ROOT + '\\') && candidate !== join(PUBLIC_ROOT, 'index.html')) return json(response, 403, { error: 'Accès refusé.' });
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error('not file');
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(candidate)] || 'application/octet-stream',
      'Cache-Control': requested === '/sw.js' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'"
    });
    response.end(await readFile(candidate));
  } catch { json(response, 404, { error: 'Fichier introuvable.' }); }
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await api(request, response, url);
    else if (request.method === 'GET' || request.method === 'HEAD') await staticFile(response, url.pathname);
    else json(response, 405, { error: 'Méthode non autorisée.' });
  } catch (error) {
    console.error(error);
    json(response, error.message?.includes('volumineuse') ? 413 : 400, { error: error.message || 'Erreur serveur.' });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Astra Clim Pro démarré : http://localhost:${PORT}`);
  if (!process.env.ASTRA_TOKEN_SECRET) console.warn('ATTENTION : définissez ASTRA_TOKEN_SECRET avant un déploiement public.');
});

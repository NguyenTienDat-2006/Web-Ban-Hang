import { passwordHash, passwordMatches } from './passwords.js';
import { randomBytes, scryptSync, createHash } from 'node:crypto';

const digest = token => createHash('sha256').update(token).digest('hex');
const cookieToken = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('customer_session='))?.slice(17);
function bad(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, name, max) { if (typeof value !== 'string' || !value.trim() || value.length > max) bad(`${name} không hợp lệ.`); return value.trim(); }
function emailAddress(value) { const email = text(value, 'Email', 150).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Email không hợp lệ.'); return email; }
function password(value) { if (typeof value !== 'string' || value.length < 8 || value.length > 128) bad('Mật khẩu cần từ 8 đến 128 ký tự.'); return value; }
const safeUser = user => ({ id: user.id, name: user.name, email: user.email, phone: user.phone, role: 'CUSTOMER' });

export function registerCustomerAuth(app, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS customer_sessions (token_hash TEXT PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_orders (order_id INTEGER PRIMARY KEY REFERENCES orders(id), customer_id INTEGER NOT NULL REFERENCES customers(id));
    CREATE INDEX IF NOT EXISTS customer_orders_owner ON customer_orders(customer_id);`);
  const attempts = new Map();
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = scryptSync(randomBytes(32), dummySalt, 64);
  function currentCustomer(req) {
    const token = cookieToken(req);
    return token ? db.prepare('SELECT c.* FROM customer_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token), Date.now()) : undefined;
  }
  function requireCustomer(req, res, next) { req.customer = currentCustomer(req); if (!req.customer) return res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản khách hàng.' }); next(); }
  function throttle(req, res, next) {
    const now = Date.now(), key = req.ip;
    for (const [ip, item] of attempts) if (item.until < now) attempts.delete(ip);
    const item = attempts.get(key) || { count: 0, until: now + 15 * 60000 };
    if (item.count >= 20) return res.status(429).json({ error: 'Bạn đã thử quá nhiều lần. Thử lại sau 15 phút.' });
    item.count++; attempts.set(key, item); next();
  }
  function startSession(req, res, createUser, remember) {
    const token = randomBytes(32).toString('hex'), duration = remember ? 30 * 86400000 : 8 * 3600000;
    let user;
    db.exec('BEGIN IMMEDIATE');
    try {
    user=createUser();
    const previous = cookieToken(req); if (previous) db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').run(digest(previous));
    db.prepare('DELETE FROM customer_sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO customer_sessions(token_hash,customer_id,expires_at) VALUES (?,?,?)').run(digest(token), user.id, Date.now() + duration);
    db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
    res.cookie('customer_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/', ...(remember ? { maxAge: duration } : {}) });
    res.json({ user: safeUser(user) });
  }
  app.post('/api/auth/register', throttle, (req, res) => {
    const b = req.body || {}, name = text(b.name, 'Họ tên', 100), email = emailAddress(b.email), phone = text(b.phone, 'Số điện thoại', 20), pass = password(b.password);
    if (!/^(?:\+84|0)[0-9]{9,10}$/.test(phone)) bad('Số điện thoại không hợp lệ.');
    if (b.confirm_password !== pass) bad('Mật khẩu nhập lại không khớp.');
    if (db.prepare('SELECT id FROM customers WHERE email=?').get(email)) bad('Email đã được đăng ký.', 409);
    const saved = passwordHash(pass);
    res.status(201); startSession(req, res, () => {
      if(db.prepare('SELECT id FROM customers WHERE email=?').get(email))bad('Email đã được đăng ký.',409);
      const id = Number(db.prepare('INSERT INTO customers(name,email,phone,password_hash) VALUES (?,?,?,?)').run(name, email, phone, saved).lastInsertRowid);
      return {id,name,email,phone};
    }, false);
  });
  app.post('/api/auth/login', throttle, (req, res) => {
    const b = req.body || {}, email = emailAddress(b.email), pass = password(b.password);
    const user = db.prepare('SELECT * FROM customers WHERE email=?').get(email);
    const valid = passwordMatches(pass, user?.password_hash || `${dummySalt}:${dummyHash.toString('hex')}`);
    if (!user || !valid) bad('Email hoặc mật khẩu không đúng.', 401);
    startSession(req, res, () => user, b.remember === true);
  });
  app.get('/api/auth/me', requireCustomer, (req, res) => res.json({ user: safeUser(req.customer) }));
  app.post('/api/auth/logout', (req, res) => { const token = cookieToken(req); if (token) db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').run(digest(token)); res.clearCookie('customer_session', { path: '/' }); res.json({ ok: true }); });
  app.get('/api/account/orders', requireCustomer, (req, res) => {
    const orders = db.prepare('SELECT o.* FROM orders o JOIN customer_orders co ON co.order_id=o.id WHERE co.customer_id=? ORDER BY o.id DESC').all(req.customer.id);
    res.json(orders.map(order => ({ ...order, items: db.prepare('SELECT product_name,size,color,unit_price,quantity FROM order_items WHERE order_id=?').all(order.id) })));
  });
  app.get('/api/account/orders/:id', requireCustomer, (req,res)=>{
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<1)bad('ID không hợp lệ.');
    const order=db.prepare('SELECT o.* FROM orders o JOIN customer_orders co ON co.order_id=o.id WHERE o.id=? AND co.customer_id=?').get(id,req.customer.id);
    if(!order)bad('Không tìm thấy đơn hàng.',404);
    res.json({...order,items:db.prepare('SELECT product_name,sku,size,color,unit_price,quantity,unit_price*quantity AS subtotal FROM order_items WHERE order_id=?').all(id)});
  });
  return { currentCustomer };
}

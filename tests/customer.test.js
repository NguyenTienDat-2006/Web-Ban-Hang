import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('customer registration, sessions and isolated order history', async () => {
  const { app, db } = createApp({ dbPath: ':memory:', adminPassword: 'TestPassword123!' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, body, cookie) {
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), setCookie: response.headers.get('set-cookie'), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    const signup = { name: 'Nguyễn An', email: 'AN@example.com', phone: '0901234567', password: 'Password123!', confirm_password: 'Password123!' };
    assert.equal((await request('/api/auth/register', { ...signup, confirm_password: 'mismatch' })).status, 400);
    const registered = await request('/api/auth/register', signup);
    assert.equal(registered.status, 201);
    assert.equal(registered.data.user.email, 'an@example.com');
    assert.equal(registered.data.user.password_hash, undefined);
    assert.match(registered.setCookie, /HttpOnly/); assert.match(registered.setCookie, /SameSite=Strict/);
    assert.doesNotMatch(registered.setCookie, /Max-Age=/);
    assert.notEqual(db.prepare('SELECT password_hash FROM customers').get().password_hash, signup.password);
    assert.equal((await request('/api/auth/register', signup)).status, 409);
    assert.equal((await request('/api/auth/login', { email: signup.email, password: 'WrongPassword' })).status, 401);
    assert.equal((await request('/api/account/orders')).status, 401);
    assert.equal((await request('/api/admin/orders', undefined, registered.cookie)).status, 403);
    const product = (await request('/api/products')).data[0];
    const body = { customer_name: signup.name, customer_phone: signup.phone, customer_email: signup.email, shipping_address: '123 Nguyễn Huệ, TP.HCM', items: [{ variant_id: product.variants[0].id, quantity: 1 }], customer_id: 999 };
    const guest = await request('/api/orders', body);
    const owned = await request('/api/orders', body, registered.cookie);
    assert.equal(owned.status, 201);
    const history = await request('/api/account/orders', undefined, registered.cookie);
    assert.equal(history.data.length, 1); assert.equal(history.data[0].order_code, owned.data.order_code);
    assert.notEqual(history.data[0].order_code, guest.data.order_code);
    const other = await request('/api/auth/register', { ...signup, email: 'other@example.com' });
    assert.equal((await request('/api/account/orders', undefined, other.cookie)).data.length, 0);
    const login = await request('/api/auth/login', { email: signup.email, password: signup.password, remember: true }, registered.cookie);
    assert.match(login.setCookie, /Max-Age=2592000/);
    assert.equal((await request('/api/auth/me', undefined, registered.cookie)).status, 401);
    assert.equal((await request('/api/auth/me', undefined, login.cookie)).status, 200);
    await request('/api/auth/logout', {}, login.cookie);
    assert.equal((await request('/api/auth/me', undefined, login.cookie)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});

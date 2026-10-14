import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {cart} from '../public/assets/common.js';

async function fixture(t,password='TestPassword123!'){
  const {app,db}=createApp({dbPath:':memory:',adminPassword:password});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(url,{method='GET',body,cookie,raw,headers={}}={}){
    const res=await fetch(base+url,{method,redirect:'manual',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...((raw!==undefined||body!==undefined)?{body:raw??JSON.stringify(body)}:{})});
    return {status:res.status,data:res.headers.get('content-type')?.includes('json')?await res.json():await res.text(),cookie:res.headers.get('set-cookie')?.split(';')[0],location:res.headers.get('location')};
  }
  const login=await request('/api/admin/login',{method:'POST',body:{username:'admin',password}});
  assert.equal(login.status,200);
  return {request,db,admin:login.cookie};
}

test('missing/malformed payloads and malformed variants return 400, preserve data and keep server responsive',async t=>{
  const {request,db,admin}=await fixture(t);
  for(const [url,cookie,method='POST'] of [['/api/orders'],['/api/admin/login'],['/api/admin/products',admin],['/api/admin/orders/1/payment',admin,'PATCH']]){
    for(const raw of [undefined,'null','[]','"text"','{']){
      assert.equal((await request(url,{method,raw,cookie})).status,400);
    }
  }
  assert.equal((await request('/api/admin/orders/1/payment',{method:'PATCH',cookie:admin})).status,400);
  const product=(await request('/api/products')).data[0];
  for(const variants of [[null],[[]],[{size:'M',color:'Black',stock:1,id:{}}],[product.variants[0]], [...product.variants,product.variants[0]]]){
    assert.equal((await request('/api/admin/products',{method:'POST',body:{...product,variants},cookie:admin})).status,400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n,5);
  assert.equal((await request('/api/products')).status,200);
});

test('variant pairs containing separators remain distinct, duplicate pairs and IDs are rejected',async t=>{
  const {request,db,admin}=await fixture(t);
  const body={name:'Pair test',category_id:1,price:100,variants:[{size:'A|B',color:'C',stock:2},{size:'A',color:'B|C',stock:2}]};
  const created=await request('/api/admin/products',{method:'POST',body,cookie:admin});assert.equal(created.status,201);
  const product=(await request('/api/admin/products',{cookie:admin})).data.find(p=>p.id===created.data.id);
  const duplicate={...product,variants:[...product.variants,{...product.variants[0],size:'D'}]};
  assert.equal((await request('/api/admin/products/'+product.id,{method:'PUT',body:duplicate,cookie:admin})).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_variants WHERE product_id=?').get(product.id).n,2);
});

test('admin passwords retain whitespace and re-login revokes the previous session',async t=>{
  const password='  TestPassword123!  ',{request,admin}=await fixture(t,password);
  assert.equal((await request('/api/admin/login',{method:'POST',body:{username:'admin',password:password.trim()}})).status,401);
  const login=await request('/api/admin/login',{method:'POST',body:{username:'admin',password},cookie:admin});
  assert.equal(login.status,200);
  assert.equal((await request('/api/admin/me',{cookie:admin})).status,401);
  assert.equal((await request('/api/admin/me',{cookie:login.cookie})).status,200);
});

test('static aliases cannot expose admin and the public login contains only login content',async t=>{
  const {request}=await fixture(t);
  for(const url of ['/admin.html.','/admin.html%20','/%61dmin.html','/ADMIN.HTML','/admin.html/','/folder/%2e%2e/admin.html'])assert.equal((await request(url)).location,'/admin-login.html');
  assert.equal((await request('/admin.html::$DATA')).status,400);
  const login=await request('/admin-login.html');assert.equal(login.status,200);
  assert.doesNotMatch(login.data,/id="dashboard"|id="product-form"/);
  assert.match(login.data,/assets\/admin-login.js/);
});

test('customer signup and session creation roll back together on database failure',async t=>{
  const {request,db}=await fixture(t);
  db.exec("CREATE TRIGGER reject_session BEFORE INSERT ON customer_sessions BEGIN SELECT RAISE(ABORT,'test session failure'); END;");
  const body={name:'An',email:'an@example.com',phone:'0901234567',password:'Password123!',confirm_password:'Password123!'};
  // The injected DB failure is intentional; suppress only its expected log.
  const original=console.error;console.error=()=>{};
  try {assert.equal((await request('/api/auth/register',{method:'POST',body})).status,500);}
  finally {console.error=original;}
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n,0);
  db.exec('DROP TRIGGER reject_session');
  assert.equal((await request('/api/auth/register',{method:'POST',body})).status,201);
});

test('corrupted cart entries do not erase valid items or forward client prices',()=>{
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>JSON.stringify([null,{variant_id:1,quantity:2,price:1},{variant_id:-1,quantity:1},{variant_id:2,quantity:100},{variant_id:3,quantity:1.5}])};
  try {assert.deepEqual(cart(),[{variant_id:1,quantity:2}]);}
  finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});

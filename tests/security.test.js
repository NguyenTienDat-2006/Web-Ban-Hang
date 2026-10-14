import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { passwordHash, passwordMatches } from '../src/passwords.js';

test('roles, validation, ownership, payment separation and safe deletion',async()=>{
  const {app,db}=createApp({dbPath:':memory:',adminPassword:'TestPassword123!'});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(url,method='GET',body,cookie){
    const res=await fetch(base+url,{method,redirect:'manual',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,data:res.headers.get('content-type')?.includes('json')?await res.json():await res.text(),cookie:res.headers.get('set-cookie')?.split(';')[0],location:res.headers.get('location')};
  }
  try {
    assert.equal((await request('/admin.html')).location,'/admin-login.html');
    assert.equal((await request('/%61dmin.html')).location,'/admin-login.html');
    assert.equal((await request('/ADMIN.HTML')).location,'/admin-login.html');
    const login=await request('/api/admin/login','POST',{username:'admin',password:'TestPassword123!'}),admin=login.cookie;
    assert.equal((await request('/admin.html','GET',undefined,admin)).status,200);
    const signup={name:'An',email:'an@example.com',phone:'0901234567',password:'Password123!',confirm_password:'Password123!'};
    const customer=(await request('/api/auth/register','POST',signup)).cookie;
    assert.equal((await request('/api/auth/register','POST',signup)).status,409);
    for(const [method,url,body] of [['GET','/api/admin/dashboard'],['POST','/api/admin/products',{}],['PUT','/api/products/1',{}],['DELETE','/api/products/1'],['PATCH','/api/admin/orders/1',{status:'confirmed'}]]){
      assert.equal((await request(url,method,body)).status,401);
      assert.equal((await request(url,method,body,customer)).status,403);
    }
    const product=(await request('/api/products')).data[0],variant=product.variants[0];
    for(const b of [{...product,price:-1},{...product,name:' '},{...product,variants:[{size:'M',color:'Black',stock:-1}]}])assert.equal((await request('/api/admin/products','POST',b,admin)).status,400);
    assert.equal((await request('/api/admin/products/99999','PUT',product,admin)).status,404);
    assert.equal((await request('/api/admin/products/nope','DELETE',undefined,admin)).status,400);
    const orderBody={customer_name:'An',customer_phone:'0901234567',shipping_address:'123 Test',items:[{variant_id:variant.id,quantity:1,price:1}],total:1,payment_status:'paid'};
    for(const quantity of [-1,0,1.5,99])assert.ok((await request('/api/orders','POST',{...orderBody,items:[{variant_id:variant.id,quantity}]})).status>=400);
    assert.equal((await request('/api/orders','POST',{...orderBody,items:[null]})).status,400);
    assert.equal((await request('/api/orders','POST',{...orderBody,items:[{variant_id:99999,quantity:1}]})).status,409);
    const created=await request('/api/orders','POST',orderBody,customer);assert.equal(created.status,201);
    assert.equal(created.data.total,product.price+(product.price>=600000?0:30000));
    const order=db.prepare('SELECT * FROM orders WHERE order_code=?').get(created.data.order_code);
    const other=(await request('/api/auth/register','POST',{...signup,email:'other@example.com'})).cookie;
    assert.equal((await request('/api/account/orders/'+order.id,'GET',undefined,other)).status,404);
    assert.equal((await request('/api/account/orders/'+order.id,'GET',undefined,customer)).status,200);
    for(const status of ['confirmed','shipping','completed'])assert.equal((await request('/api/admin/orders/'+order.id,'PATCH',{status},admin)).status,200);
    assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id=?').get(order.id).payment_status,'unpaid');
    assert.equal((await request('/api/admin/orders/'+order.id+'/payment','PATCH',{payment_status:'invalid'},admin)).status,400);
    assert.equal((await request('/api/admin/orders/'+order.id+'/payment','PATCH',{payment_status:'paid'},admin)).status,200);
    assert.equal((await request('/api/admin/dashboard','GET',undefined,admin)).data.revenue,created.data.total);
    db.prepare("INSERT INTO admin_users(username,password_hash,role) VALUES (?,?,'STAFF')").run('staff',passwordHash('StaffPassword123!'));
    const staff=(await request('/api/admin/login','POST',{username:'staff',password:'StaffPassword123!'})).cookie;
    assert.equal((await request('/api/admin/me','GET',undefined,staff)).data.user.role,'STAFF');
    assert.equal((await request('/api/admin/orders/'+order.id,'GET',undefined,staff)).status,200);
    assert.equal((await request('/api/admin/products/'+product.id,'DELETE',undefined,staff)).status,200);
    assert.equal((await request('/api/admin/products/'+product.id,'DELETE',undefined,staff)).status,404);
    assert.ok(!(await request('/api/products')).data.some(p=>p.id===product.id));
    assert.equal(db.prepare('SELECT product_id,subtotal FROM order_items WHERE order_id=?').get(order.id).product_id,product.id);
    assert.equal((await request('/api/orders','POST',orderBody)).status,409);
    assert.equal(passwordMatches('wrong','malformed'),false);
  } finally {await new Promise(r=>server.close(r));db.close();}
});

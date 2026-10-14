import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
test('checkout, transaction rollback, admin protection and cancellation',async()=>{
 const {app,db}=createApp({dbPath:':memory:',adminPassword:'TestPassword123!',bank:{enabled:true,bankId:'VCB',bankName:'Vietcombank',accountNo:'102314566',accountName:'NGUYEN TIEN DAT'}}); const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 async function request(url,body,cookie,method=body?'POST':'GET'){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 try{
  assert.equal((await request('/api/admin/products')).status,401);
  assert.equal((await request('/api/products')).data.length,5);
  assert.equal((await request('/api/products',{})).status,401);
  const p=(await request('/api/products')).data[0],v=p.variants[0];const body={customer_name:'Khách thử',customer_phone:'0901234567',shipping_address:'123 Nguyễn Huệ, TP.HCM',items:[{variant_id:v.id,quantity:2}],total:1};
  const order=await request('/api/orders',body);assert.equal(order.status,201);assert.equal(order.data.total,p.price*2+(p.price*2>=600000?0:30000));assert.equal(db.prepare('SELECT stock FROM product_variants WHERE id=?').get(v.id).stock,13);
  const invalid=await request('/api/orders',{...body,items:[{variant_id:v.id,quantity:1},{variant_id:9999,quantity:1}]});assert.equal(invalid.status,409);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);assert.equal(db.prepare('SELECT stock FROM product_variants WHERE id=?').get(v.id).stock,13);
  assert.equal((await request('/api/admin/login',{username:'admin',password:'incorrectpassword'})).status,401);
  const login=await request('/api/admin/login',{username:'admin',password:'TestPassword123!'});assert.equal(login.status,200);const cookie=login.cookie;
  const newProduct={name:'Áo test',category_id:1,price:150000,variants:[{size:'M',color:'Đen',stock:10}]};
  const created=await request('/api/products',newProduct,cookie);assert.equal(created.status,201);
  assert.ok((await request('/api/products')).data.some(p=>p.id===created.data.id&&p.variants[0].stock===10));
  assert.equal((await request('/api/admin/orders/1',{status:'completed'},cookie,'PATCH')).status,409);
  assert.equal((await request('/api/admin/orders/1',{status:'cancelled'},cookie,'PATCH')).status,200);assert.equal(db.prepare('SELECT stock FROM product_variants WHERE id=?').get(v.id).stock,15);
  assert.equal((await request('/api/admin/orders/1',{status:'cancelled'},cookie,'PATCH')).status,409);assert.equal(db.prepare('SELECT stock FROM product_variants WHERE id=?').get(v.id).stock,15);
  const updated={...p,name:'Tên mới',variants:p.variants};assert.equal((await request(`/api/admin/products/${p.id}`,updated,cookie,'PUT')).status,200);assert.equal(db.prepare('SELECT product_name FROM order_items LIMIT 1').get().product_name,p.name);
  await request('/api/admin/logout',{},cookie);assert.equal((await request('/api/admin/orders',undefined,cookie)).status,401);
  const transfer=await request('/api/orders',{...body,payment_method:'bank_transfer',items:[{variant_id:p.variants[1].id,quantity:1}]});
  assert.equal(transfer.status,201);const qr=new URL(transfer.data.payment.qr_url);
  assert.equal(qr.searchParams.get('amount'),String(transfer.data.total));
  assert.equal(qr.searchParams.get('addInfo'),`DH${transfer.data.order_code}`);
  assert.ok(transfer.data.payment.expires_at>Date.now()+290000);
  const reportUrl=`/api/orders/${transfer.data.order_code}/payment-report`;
  assert.equal((await request(reportUrl,{payment_token:'wrong-token'})).status,404);
  const report={payment_token:transfer.data.payment_token};
  assert.equal((await request(reportUrl,report)).status,200);
  assert.equal((await request(reportUrl,report)).data.payment_status,'unpaid');
  assert.equal(db.prepare('SELECT payment_status FROM orders WHERE order_code=?').get(transfer.data.order_code).payment_status,'unpaid');
  const expired=await request('/api/orders',{...body,payment_method:'bank_transfer',items:[{variant_id:p.variants[1].id,quantity:1}]});
  db.prepare('UPDATE order_payments SET expires_at=0 WHERE token_hash=(SELECT token_hash FROM order_payments ORDER BY order_id DESC LIMIT 1)').run();
  assert.equal((await request(`/api/orders/${expired.data.order_code}/payment-report`,{payment_token:expired.data.payment_token})).status,409);
 }finally{await new Promise(r=>server.close(r));db.close();}
});

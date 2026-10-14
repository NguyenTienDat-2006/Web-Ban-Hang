import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bankConfig, paymentDetails } from './payments.js';
import { passwordHash, passwordMatches } from './passwords.js';
import { registerCustomerAuth } from './customer-auth.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
function fail(message, status=400) { const e = new Error(message); e.status=status; throw e; }
function str(value, label, max=200, required=true) { if(typeof value!=='string'||value.length>max||(required&&!value.trim())) fail(`${label} không hợp lệ.`); return value.trim(); }
function integer(value,label,min=0,max=1000000000) { if(!Number.isSafeInteger(value)||value<min||value>max) fail(`${label} không hợp lệ.`); return value; }

export function createApp({dbPath=path.join(root,'storage/shop.sqlite'),adminPassword=process.env.ADMIN_PASSWORD,adminUsername=process.env.ADMIN_USERNAME||'admin',seed=true,bank=bankConfig()}={}) {
  if(typeof adminPassword!=='string'||adminPassword.length<12||adminPassword.length>200) throw new Error('ADMIN_PASSWORD phải có ít nhất 12 ký tự. Xem README.md.');
  if(dbPath!==':memory:') mkdirSync(path.dirname(dbPath),{recursive:true});
  const db=new DatabaseSync(dbPath);
  try {
  db.exec(readFileSync(new URL('./db/schema.sql',import.meta.url),'utf8')); db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('BEGIN IMMEDIATE');
  if(!db.prepare('PRAGMA table_info(admin_users)').all().some(c=>c.name==='role')) db.exec("ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'ADMIN' CHECK(role IN ('ADMIN','STAFF'))");
    const columns=db.prepare('PRAGMA table_info(order_items)').all().map(c=>c.name);
    if(!columns.includes('product_id'))db.exec('ALTER TABLE order_items ADD COLUMN product_id INTEGER REFERENCES products(id)');
    if(!columns.includes('subtotal'))db.exec('ALTER TABLE order_items ADD COLUMN subtotal INTEGER');
    db.exec('UPDATE order_items SET product_id=(SELECT product_id FROM product_variants WHERE id=order_items.variant_id) WHERE product_id IS NULL; UPDATE order_items SET subtotal=unit_price*quantity WHERE subtotal IS NULL;');

  if(!db.prepare('SELECT id FROM admin_users WHERE username=?').get(adminUsername)) db.prepare('INSERT INTO admin_users(username,password_hash) VALUES (?,?)').run(adminUsername,passwordHash(adminPassword));
  if(seed&&!db.prepare('SELECT id FROM categories LIMIT 1').get()) {
    db.prepare('INSERT INTO categories(id,name,slug) VALUES (?,?,?)').run(1,'Áo','ao'); db.prepare('INSERT INTO categories(id,name,slug) VALUES (?,?,?)').run(2,'Quần','quan'); db.prepare('INSERT INTO categories(id,name,slug) VALUES (?,?,?)').run(3,'Váy','vay');
    const samples=[['Áo thun Essential',1,249000,'photo-1521572163474-6864f9cf17ab','Trắng'],['Sơ mi Everyday',1,389000,'photo-1596755094514-f87e34085b2c','Be'],['Quần denim Classic',2,549000,'photo-1542272604-787c3835535d','Xanh'],['Váy Summer Muse',3,459000,'photo-1515372039744-b8f02a3ae446','Kem'],['Áo khoác Urban',1,699000,'photo-1551028719-00167b16eac5','Đen'],['Quần Relaxed',2,399000,'photo-1473966968600-fa801b869a1a','Be']];
    samples.slice(0,5).forEach(([name,cat,price,image,color],i)=>{ const id=Number(db.prepare('INSERT INTO products(category_id,name,description,price,image_url) VALUES (?,?,?,?,?)').run(cat,name,'Thiết kế dễ phối, phom thoải mái cho mỗi ngày. Chọn size phù hợp với bạn.',price,`https://images.unsplash.com/${image}?auto=format&fit=crop&w=800&q=80`).lastInsertRowid); ['S','M','L','XL'].forEach(size=>db.prepare('INSERT INTO product_variants(product_id,sku,size,color,stock) VALUES (?,?,?,?,?)').run(id,`MOC-${i+1}-${size}`,size,color,15)); });
  }
  db.exec('COMMIT');
  } catch(error) {try{if(db.isTransaction)db.exec('ROLLBACK');}finally{db.close();}throw error;}
  const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'64kb'}));
  app.use((req,res,next)=>{ res.set('X-Content-Type-Options','nosniff'); res.set('X-Frame-Options','DENY'); res.set('Referrer-Policy','strict-origin-when-cross-origin'); if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store'); if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin){ let origin; try{origin=new URL(req.headers.origin).host;}catch{return res.status(403).json({error:'Nguồn yêu cầu không hợp lệ.'});} if(origin!==req.headers.host)return res.status(403).json({error:'Nguồn yêu cầu không hợp lệ.'}); } next(); });
  app.use('/api',(req,res,next)=>{
    if(!['POST','PUT','PATCH'].includes(req.method))return next();
    if(req.body===undefined)req.body={};
    if(req.body===null||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({error:'Body phải là JSON object.'});
    next();
  });
  const attempts=new Map();
  const dummyAdminHash=passwordHash(randomBytes(32).toString('hex'));
  const {currentCustomer}=registerCustomerAuth(app,db);
  function currentAdmin(req) {
    const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
    return token && db.prepare('SELECT u.id,u.username,u.role FROM sessions s JOIN admin_users u ON u.id=s.admin_id WHERE s.token=? AND s.expires_at>?').get(hash(token),Date.now());
  }
  function admin(req,res,next) {
    req.admin=currentAdmin(req);
    if(!req.admin)return res.status(currentCustomer(req)?403:401).json({error:'Bạn cần quyền ADMIN hoặc STAFF.'});
    if(!['ADMIN','STAFF'].includes(req.admin.role))return res.status(403).json({error:'Không đủ quyền.'});
    next();
  }
  app.get(['/admin.html','/admin'],(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!currentAdmin(req))return res.redirect('/admin-login.html');
    admin(req,res,()=>res.sendFile(path.join(root,'public/admin.html')));
  });
  const productList=(all=false)=>db.prepare(`SELECT p.*,c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id ${all?'':'WHERE p.is_active=1'} ORDER BY p.id DESC`).all().map(p=>({...p,variants:db.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY id').all(p.id)}));
  app.get('/api/categories',(req,res)=>res.json(db.prepare('SELECT * FROM categories').all()));
  app.get('/api/payment-config',(req,res)=>res.json({bank_transfer_enabled:bank.enabled}));
  app.get('/api/products',(req,res)=>res.json(productList().filter(p=>!req.query.category||p.category_id===Number(req.query.category))));
  app.post('/api/orders',(req,res)=>{
    const method=req.body.payment_method??'cod';
    if(!['cod','bank_transfer'].includes(method))fail('Phương thức thanh toán không hợp lệ.');
    if(method==='bank_transfer'&&!bank.enabled)fail('Cửa hàng chưa cấu hình tài khoản nhận chuyển khoản.',503);
    const b=req.body; const name=str(b.customer_name,'Họ tên',100), phone=str(b.customer_phone,'Điện thoại',20), address=str(b.shipping_address,'Địa chỉ',500), email=str(b.customer_email??'','Email',150,false),note=str(b.note??'','Ghi chú',500,false);
    if(!/^(?:\+84|0)[0-9]{9,10}$/.test(phone))fail('Số điện thoại không hợp lệ.');
    if(!Array.isArray(b.items)||!b.items.length||b.items.length>50)fail('Giỏ hàng không hợp lệ.');
    const quantities=new Map(); for(const item of b.items){if(!item||typeof item!=='object')fail('Mặt hàng không hợp lệ.');const id=integer(item.variant_id,'Biến thể',1),qty=integer(item.quantity,'Số lượng',1,99);quantities.set(id,(quantities.get(id)||0)+qty);}
    db.exec('BEGIN IMMEDIATE'); try {
      const items=[...quantities].map(([id,qty])=>{integer(qty,'Số lượng',1,99); const v=db.prepare('SELECT v.*,p.name,p.price,p.is_active FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=?').get(id); if(!v||!v.is_active||v.stock<qty)fail('Một sản phẩm đã ngừng bán hoặc không đủ tồn kho.',409);return {...v,qty};});
      const subtotal=items.reduce((s,v)=>s+v.price*v.qty,0),shipping=subtotal>=600000?0:30000,code=`MOC-${randomBytes(6).toString('hex').toUpperCase()}`;
      const id=Number(db.prepare('INSERT INTO orders(order_code,customer_name,customer_phone,customer_email,shipping_address,note,subtotal,shipping_fee,total) VALUES (?,?,?,?,?,?,?,?,?)').run(code,name,phone,email,address,note,subtotal,shipping,subtotal+shipping).lastInsertRowid);
      const customer=currentCustomer(req);
      if(customer)db.prepare('INSERT INTO customer_orders(order_id,customer_id) VALUES (?,?)').run(id,customer.id);
      for(const v of items){db.prepare('INSERT INTO order_items(order_id,variant_id,product_name,sku,size,color,unit_price,quantity) VALUES (?,?,?,?,?,?,?,?)').run(id,v.id,v.name,v.sku,v.size,v.color,v.price,v.qty);db.prepare('UPDATE product_variants SET stock=stock-? WHERE id=?').run(v.qty,v.id);}
      db.prepare('UPDATE order_items SET product_id=(SELECT product_id FROM product_variants WHERE id=order_items.variant_id),subtotal=unit_price*quantity WHERE order_id=?').run(id);
      db.prepare('UPDATE orders SET payment_method=? WHERE id=?').run(method,id);
      const order={order_code:code,total:subtotal+shipping,payment_method:method};
      if(method==='bank_transfer'){
        const token=randomBytes(32).toString('hex'),expiresAt=Date.now()+5*60*1000;
        db.prepare('INSERT INTO order_payments(order_id,token_hash,expires_at) VALUES (?,?,?)').run(id,hash(token),expiresAt);
        order.payment=paymentDetails(bank,order,expiresAt);order.payment_token=token;
      }
      db.exec('COMMIT');res.status(201).json(order);
    }catch(e){db.exec('ROLLBACK');throw e;}
  });
  app.post('/api/orders/:code/payment-report',(req,res)=>{
    const token=str(req.body.payment_token,'Mã xác nhận',100);
    const payment=db.prepare('SELECT op.*,o.status,o.payment_status FROM order_payments op JOIN orders o ON o.id=op.order_id WHERE o.order_code=? AND op.token_hash=?').get(req.params.code,hash(token));
    if(!payment)fail('Không tìm thấy phiên thanh toán.',404);
    if(payment.status==='cancelled')fail('Đơn hàng đã bị hủy.',409);
    if(payment.reported_at)return res.json({reported:true,payment_status:payment.payment_status});
    if(payment.expires_at<=Date.now())fail('Phiên QR đã hết hạn. Liên hệ cửa hàng nếu bạn đã chuyển khoản.',409);
    db.prepare('UPDATE order_payments SET reported_at=? WHERE order_id=? AND reported_at IS NULL').run(Date.now(),payment.order_id);
    res.json({reported:true,payment_status:payment.payment_status});
  });
  app.post('/api/admin/login',(req,res)=>{ const key=req.ip,now=Date.now(); let attempt=attempts.get(key);if(!attempt||attempt.until<now){attempt={count:0,until:now+900000};attempts.set(key,attempt);} if(attempt.count>=10)fail('Thử lại sau 15 phút.',429);attempt.count++;
    for(const [ip,item] of attempts)if(item.until<now)attempts.delete(ip);
    const username=str(req.body.username,'Tài khoản',100),pass=req.body.password;if(typeof pass!=='string'||!pass.length||pass.length>200)fail('Mật khẩu không hợp lệ.'); const user=db.prepare('SELECT * FROM admin_users WHERE username=?').get(username); const valid=passwordMatches(pass,user?.password_hash||dummyAdminHash);if(!user||!valid||!['ADMIN','STAFF'].includes(user.role))fail('Tài khoản hoặc mật khẩu sai.',401);
    const previous=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8),token=randomBytes(32).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      if(previous)db.prepare('DELETE FROM sessions WHERE token=?').run(hash(previous));
      db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now);
      db.prepare('INSERT INTO sessions(token,admin_id,expires_at) VALUES (?,?,?)').run(hash(token),user.id,now+8*3600000);
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
    attempts.delete(key);
    res.cookie('session',token,{httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true',maxAge:8*3600000,path:'/'});res.json({ok:true});
  });
  app.use('/api/admin',admin);
  app.get('/api/admin/me',(req,res)=>res.json({ok:true,user:req.admin}));
  app.post('/api/admin/logout',(req,res)=>{const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));res.clearCookie('session',{path:'/'});res.json({ok:true});});
  app.get('/api/admin/dashboard',(req,res)=>res.json({
    products:db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active=1').get().n,
    customers:db.prepare('SELECT COUNT(*) AS n FROM customers').get().n,
    orders:db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
    revenue:db.prepare("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status='completed' AND payment_status='paid'").get().n
  }));
  function deleteProduct(req,res) {
    const id=integer(Number(req.params.id),'ID',1);
    if(!db.prepare('SELECT id FROM products WHERE id=? AND is_active=1').get(id))fail('Không tìm thấy sản phẩm.',404);
    db.prepare('UPDATE products SET is_active=0 WHERE id=?').run(id);
    res.json({ok:true});
  }
  app.delete('/api/admin/products/:id',deleteProduct);
  app.delete('/api/products/:id',admin,deleteProduct);
  app.put('/api/products/:id',admin,saveProduct);
  app.get('/api/admin/products',(req,res)=>res.json(productList(true)));
  function saveProduct(req,res){const b=req.body,name=str(b.name,'Tên sản phẩm',150),description=str(b.description??'','Mô tả',2000,false),price=integer(b.price,'Giá',0,100000000),cat=integer(b.category_id,'Danh mục',1),url=str(b.image_url??'','Ảnh',1500,false);if(url&&!/^https?:\/\//i.test(url))fail('Ảnh phải là URL HTTP/HTTPS.');if(!db.prepare('SELECT id FROM categories WHERE id=?').get(cat))fail('Danh mục không tồn tại.');if(!Array.isArray(b.variants)||!b.variants.length||b.variants.length>40)fail('Cần ít nhất một biến thể.');const variants=b.variants.map(v=>{
      if(!v||typeof v!=='object'||Array.isArray(v))fail('Biến thể không hợp lệ.');
      return {id:v.id===undefined?undefined:integer(v.id,'ID biến thể',1),size:str(v.size,'Size',20),color:str(v.color,'Màu',50),stock:integer(v.stock,'Tồn kho',0,100000)};
    });
    const variantIds=variants.filter(v=>v.id!==undefined).map(v=>v.id);
    if(new Set(variantIds).size!==variantIds.length)fail('ID biến thể bị trùng.');
    if(!req.params.id&&variantIds.length)fail('Sản phẩm mới không nhận ID biến thể có sẵn.');
    const combos=new Set(variants.map(v=>JSON.stringify([v.size,v.color])));if(combos.size!==variants.length)fail('Size và màu bị trùng.');const active=b.is_active===false||b.is_active===0?0:1;db.exec('BEGIN IMMEDIATE');try{let id;if(req.params.id){id=integer(Number(req.params.id),'ID',1);if(!db.prepare('SELECT id FROM products WHERE id=?').get(id))fail('Không tìm thấy sản phẩm.',404);db.prepare('UPDATE products SET name=?,description=?,price=?,category_id=?,image_url=?,is_active=? WHERE id=?').run(name,description,price,cat,url,active,id);const existing=db.prepare('SELECT id,size,color FROM product_variants WHERE product_id=?').all(id);if(existing.some(v=>!variants.some(n=>n.id===v.id&&n.size===v.size&&n.color===v.color)))fail('Giữ nguyên size/màu của biến thể hiện có. Có thể đặt tồn kho về 0.');}else{id=Number(db.prepare('INSERT INTO products(name,description,price,category_id,image_url,is_active) VALUES (?,?,?,?,?,?)').run(name,description,price,cat,url,active).lastInsertRowid);}for(const v of variants){if(v.id){if(!db.prepare('SELECT id FROM product_variants WHERE id=? AND product_id=?').get(v.id,id))fail('Biến thể không thuộc sản phẩm.');db.prepare('UPDATE product_variants SET stock=? WHERE id=?').run(v.stock,v.id);}else db.prepare('INSERT INTO product_variants(product_id,sku,size,color,stock) VALUES (?,?,?,?,?)').run(id,`MOC-${id}-${randomBytes(4).toString('hex')}`,v.size,v.color,v.stock);}db.exec('COMMIT');res.status(req.params.id?200:201).json({id});}catch(e){db.exec('ROLLBACK');throw e;}}
  app.post('/api/products',admin,(req,res)=>{res.status(201);saveProduct(req,res);});
  app.post('/api/admin/products',saveProduct);app.put('/api/admin/products/:id',saveProduct);
  app.get('/api/admin/orders',(req,res)=>res.json(db.prepare('SELECT o.*,op.reported_at AS payment_reported_at FROM orders o LEFT JOIN order_payments op ON op.order_id=o.id ORDER BY o.id DESC').all().map(o=>({...o,items:db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id)}))));
  app.patch('/api/admin/orders/:id',(req,res)=>{ const transitions={pending:['confirmed','cancelled'],confirmed:['shipping','cancelled'],shipping:['completed'],completed:[],cancelled:[]}; db.exec('BEGIN IMMEDIATE');try{const o=db.prepare('SELECT * FROM orders WHERE id=?').get(integer(Number(req.params.id),'ID',1));if(!o)fail('Không tìm thấy đơn.',404);if(!Object.hasOwn(transitions,o.status)||!transitions[o.status].includes(req.body.status))fail('Không thể chuyển trạng thái này.',409);if(req.body.status==='cancelled')for(const item of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id))if(item.variant_id)db.prepare('UPDATE product_variants SET stock=stock+? WHERE id=?').run(item.quantity,item.variant_id);db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status,o.id);db.exec('COMMIT');res.json({ok:true});}catch(e){db.exec('ROLLBACK');throw e;}});
  app.get('/api/admin/orders/:id',(req,res)=>{
    const order=db.prepare('SELECT * FROM orders WHERE id=?').get(integer(Number(req.params.id),'ID',1));
    if(!order)fail('Không tìm thấy đơn.',404);
    res.json({...order,items:db.prepare('SELECT *,unit_price*quantity AS subtotal FROM order_items WHERE order_id=?').all(order.id)});
  });
  app.patch('/api/admin/orders/:id/payment',(req,res)=>{
    if(!['unpaid','paid','failed'].includes(req.body.payment_status))fail('Trạng thái thanh toán không hợp lệ.');
    const id=integer(Number(req.params.id),'ID',1);
    const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if(!order)fail('Không tìm thấy đơn.',404);
    if(order.status==='cancelled')fail('Đơn đã hủy.',409);
    const changed=db.prepare("UPDATE orders SET payment_status=? WHERE id=? AND status!='cancelled'").run(req.body.payment_status,id);
    if(!changed.changes)fail('Đơn đã hủy.',409);
    res.json({ok:true});
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'API không tồn tại.'}));
  // Static serving decodes URLs; protect encoded/case variants on Windows too.
  app.use((req,res,next)=>{
    let resource;
    try {const decoded=decodeURIComponent(req.path).replaceAll('\\','/');
      if(decoded.includes(':')||decoded.includes('\0'))return res.status(400).json({error:'URL không hợp lệ.'});
      resource=path.posix.normalize(path.posix.normalize(decoded).split('/').map(segment=>segment.replace(/[ .]+$/,'')).join('/')).toLowerCase().replace(/\/$/,'');}
    catch {return res.status(400).json({error:'URL không hợp lệ.'});}
    if(resource==='/admin.html'){
      res.set('Cache-Control','no-store');
      if(!currentAdmin(req))return res.redirect('/admin-login.html');
      return admin(req,res,()=>res.sendFile(path.join(root,'public/admin.html')));
    }
    next();
  });
  app.use(express.static(path.join(root,'public')));
  app.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.code==='SQLITE_BUSY'||(Number.isInteger(err.errcode)&&(err.errcode&255)===5)){err.status=503;err.message='Database đang bận. Vui lòng thử lại.';}if(!err.status)console.error(err);res.status(err.status||500).json({error:err.status?err.message:'Có lỗi hệ thống. Vui lòng thử lại.'});});
  return {app,db};
}

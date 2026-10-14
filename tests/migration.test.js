import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../src/app.js';
import {passwordHash} from '../src/passwords.js';

test('additive migration preserves legacy rows, hashes and order snapshots across restarts',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'moc-migration-')),dbPath=path.join(dir,'shop.sqlite');
  let db;
  try {
    db=new DatabaseSync(dbPath);db.exec(readFileSync(new URL('../src/db/schema.sql',import.meta.url),'utf8'));
    const saved=passwordHash('TestPassword123!');
    db.prepare('INSERT INTO admin_users(username,password_hash) VALUES (?,?)').run('admin',saved);
    db.exec("INSERT INTO categories VALUES (1,'Test','test'); INSERT INTO products(id,category_id,name,price) VALUES (1,1,'Legacy',123); INSERT INTO product_variants VALUES (1,1,'SKU','M','Black',4); INSERT INTO orders(id,order_code,customer_name,customer_phone,shipping_address,subtotal,shipping_fee,total) VALUES (1,'LEGACY','An','0901234567','Test',246,0,246); INSERT INTO order_items(order_id,variant_id,product_name,sku,size,color,unit_price,quantity) VALUES (1,1,'Legacy','SKU','M','Black',123,2);");
    db.close();db=undefined;
    for(let i=0;i<2;i++){
      const created=createApp({dbPath,adminPassword:'TestPassword123!'});db=created.db;
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);
      assert.equal(db.prepare('SELECT stock FROM product_variants').get().stock,4);
      assert.equal(db.prepare('SELECT password_hash,role FROM admin_users').get().password_hash,saved);
      assert.equal(db.prepare('SELECT role FROM admin_users').get().role,'ADMIN');
      assert.deepEqual({...db.prepare('SELECT product_id,subtotal FROM order_items').get()},{product_id:1,subtotal:246});
      db.close();db=undefined;
    }
  } finally {db?.close();if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'moc-migration-'))throw new Error('Unsafe test cleanup path');rmSync(dir,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const chrome=process.env.CHROME_PATH||[
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=12000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const value=await fn();if(value)return value;await delay(100);}
  throw new Error('Timeout: '+label);
}

test('real browser: signup → login → cart → checkout → inventory → history → admin order states',{
  skip:!chrome?'Chrome/Edge unavailable; set CHROME_PATH to enable browser test.':false,
  timeout:90000
},async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'moc-browser-'));
  const dbPath=path.join(dir,'shop.sqlite');
  const adminPassword='BrowserAdminPassword123!';
  let server,browser,ws,serverLogs='',browserLogs='',nextId=0;
  const pending=new Map(),runtimeErrors=[];
  try {
    server=spawn(process.execPath,['server.js'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',DB_PATH:dbPath,ADMIN_USERNAME:'e2e_admin',ADMIN_PASSWORD:adminPassword,COOKIE_SECURE:'false',VIETQR_BANK_ID:'',VIETQR_ACCOUNT_NO:''},stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',data=>serverLogs+=data);
    server.stderr.on('data',data=>serverLogs+=data);
    const base=await until(()=>{
      if(server.exitCode!==null)throw new Error('Server failed: '+serverLogs);
      return serverLogs.match(/http:\/\/localhost:(\d+)/)?.[0];
    },'server startup');
    browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+path.join(dir,'profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    browser.stderr.on('data',data=>browserLogs+=data);
    const portFile=path.join(dir,'profile','DevToolsActivePort');
    const debugPort=await until(()=>{
      if(browser.exitCode!==null)throw new Error('Browser exited: '+browser.exitCode);
      return existsSync(portFile)?readFileSync(portFile,'utf8').split('\n')[0]:false;
    },'browser startup');
    const targets=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    ws.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.method==='Runtime.exceptionThrown')runtimeErrors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
      if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}
    });
    ws.addEventListener('error',event=>{for(const item of pending.values())item.reject(new Error('Browser websocket error: '+(event.message||'')+'; '+browserLogs));});
    const call=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++nextId;
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},10000);
      pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
    });
    async function evaluate(expression){
      const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
      return result.result.value;
    }
    async function waitFor(expression,label){return until(()=>evaluate(expression),label);}
    async function navigate(url,ready){await call('Page.navigate',{url});await waitFor(`location.href===${JSON.stringify(url)} && (${ready})`,'page ready '+url);}
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    async function submit(selector,fields){
      await evaluate(`(()=>{const form=document.querySelector(${JSON.stringify(selector)});const fields=${JSON.stringify(fields)};for(const [key,value] of Object.entries(fields)){const input=form.elements.namedItem(key);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}if(!form.checkValidity())throw new Error('Form validation failed: '+${JSON.stringify(selector)});form.requestSubmit();})()`);
    }
    await call('Browser.getVersion');await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
    await call('Network.setBlockedURLs',{urls:['https://*']});
    await navigate(base+'/',`document.querySelector('[data-add]') && document.querySelector('#auth-open') && document.querySelector('#products').getAttribute('aria-busy')==='false'`);
    const product=await evaluate("fetch('/api/products').then(r=>r.json()).then(p=>p[0])");
    const variant=product.variants.find(v=>v.stock>0);
    await click('#auth-open');await click('#register-tab');
    const customer={name:'Khách kiểm thử',email:'browser@example.com',phone:'0901234567',password:'BrowserCustomer123!',confirm_password:'BrowserCustomer123!'};
    await submit('#customer-register-form',customer);
    await waitFor("!document.querySelector('#customer-profile').hidden && !document.querySelector('#auth-dialog').open",'registration');
    await click('#account-toggle');await click('#customer-logout');
    await waitFor("!document.querySelector('#auth-open').hidden",'customer logout');
    await click('#auth-open');await submit('#customer-login-form',{email:customer.email,password:customer.password});
    await waitFor("!document.querySelector('#customer-profile').hidden && !document.querySelector('#auth-dialog').open",'customer login');
    await click(`[data-add="${product.id}"]`);
    await waitFor("document.querySelector('#cart-count').textContent==='1'",'add to cart');
    await navigate(base+'/cart.html',"document.querySelector('a[href=\"/checkout.html\"]')");
    assert.match(await evaluate("document.querySelector('#cart-items').textContent"),new RegExp(product.name));
    await navigate(base+'/checkout.html',"document.querySelector('#submit-order') && !document.querySelector('#submit-order').disabled");
    await submit('#checkout-form',{customer_name:customer.name,customer_phone:customer.phone,customer_email:customer.email,shipping_address:'123 Đường kiểm thử, TP.HCM'});
    await waitFor("!document.querySelector('#success').hidden || !!document.querySelector('#status').textContent",'checkout response');
    assert.equal(await evaluate("document.querySelector('#status').textContent"),'','checkout error');
    assert.equal(await evaluate("document.querySelector('#success').hidden"),false);
    const code=await evaluate("document.querySelector('#success').textContent.match(/MOC-[A-F0-9]+/)[0]");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('moc-cart')).length"),0);
    const db=new DatabaseSync(dbPath,{readOnly:true});
    try {
      assert.equal(db.prepare('SELECT stock FROM product_variants WHERE id=?').get(variant.id).stock,variant.stock-1);
      const order=db.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
      assert.equal(order.total,product.price+(product.price>=600000?0:30000));
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customer_orders WHERE order_id=?').get(order.id).n,1);
    } finally {db.close();}
    await navigate(base+'/',"document.querySelector('#customer-profile') && !document.querySelector('#customer-profile').hidden");
    await click('#account-toggle');await click('[data-account="orders"]');
    await waitFor(`document.querySelector('#account-content').textContent.includes(${JSON.stringify(code)})`,'customer order history');
    await click('[data-order-detail]');
    await waitFor("document.querySelector('[data-order-address]').textContent.includes('123 Đường kiểm thử')",'customer order detail');
    await call('Page.navigate',{url:base+'/admin.html'});
    await waitFor("location.pathname==='/admin-login.html' && !!document.querySelector('#login') && !document.querySelector('#login button').disabled",'admin login redirect');
    await submit('#login',{username:'e2e_admin',password:adminPassword});
    await waitFor("location.pathname==='/admin.html' && document.querySelector('#orders-panel [data-order]')",'admin login and order list');
    await click('[data-tab="orders"]');
    assert.ok(await evaluate(`document.querySelector('#orders-panel').textContent.includes(${JSON.stringify(code)})`));
    for(const status of ['confirmed','shipping','completed']){
      await click(`[data-status="${status}"]`);
      await waitFor(`fetch('/api/admin/orders').then(r=>r.json()).then(orders=>orders.find(o=>o.order_code===${JSON.stringify(code)})?.status===${JSON.stringify(status)})`,'admin status '+status);
      await waitFor(status==='completed'?"!document.querySelector('[data-order]')":`!!document.querySelector('[data-status="${status==='confirmed'?'shipping':'completed'}"]')`,'admin render '+status);
    }
    assert.equal(await evaluate(`fetch('/api/admin/orders').then(r=>r.json()).then(orders=>orders.find(o=>o.order_code===${JSON.stringify(code)}).payment_status)`),'unpaid');
    assert.deepEqual(runtimeErrors,[],'browser runtime errors');
    console.log('Browser flow passed: customer registration/login, product/cart, checkout, stock -1, owned history/detail, admin login, confirmed → shipping → completed; payment remains unpaid.');
    await call('Browser.close').catch(()=>{});
  } finally {
    ws?.close();for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Browser closed'));}
    if(browser&&browser.exitCode===null){browser.kill();await delay(300);}
    if(server&&server.exitCode===null){server.kill();await delay(300);}
    if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'moc-browser-'))throw new Error('Unsafe test cleanup path');
    rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
});

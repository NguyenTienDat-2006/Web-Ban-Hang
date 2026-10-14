import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const envFile = new URL('../.env', import.meta.url);
if(existsSync(envFile)) process.loadEnvFile(envFile);
const port=process.env.PORT===undefined?3000:Number(process.env.PORT);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT phải là số nguyên từ 0 đến 65535.');
const configuredPath=process.env.DB_PATH;
const dbPath=configuredPath&&configuredPath!==':memory:'?path.resolve(fileURLToPath(new URL('../',import.meta.url)),configuredPath):configuredPath||undefined;
const {app,db}=createApp({dbPath});
const server=app.listen(port,'127.0.0.1',()=>{
  const actualPort=server.address().port;
  console.log(`MỘC Store: http://localhost:${actualPort}\nAdmin: http://localhost:${actualPort}/admin.html`);
});
server.on('error',error=>{
  console.error(error.code==='EADDRINUSE'?'Cổng đang được sử dụng. Hãy dừng server cũ hoặc đổi PORT.':`Không thể khởi động server: ${error.message}`);
  db.close();process.exitCode=1;
});
let stopping=false;
function shutdown(){
  if(stopping)return;stopping=true;
  server.close(()=>db.close());
  server.closeIdleConnections();
}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);

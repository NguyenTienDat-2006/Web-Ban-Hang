import { api } from './common.js';

const form=document.querySelector('#login');
const status=document.querySelector('#status');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=form.querySelector('button');button.disabled=true;status.textContent='';
  try {
    await api('/api/admin/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    form.reset();location.replace('/admin.html');
  } catch(error) {status.textContent=error.message;}
  finally {button.disabled=false;}
});
form.querySelector('button').disabled=false;
try {await api('/api/admin/me');location.replace('/admin.html');}
catch(error) {if(error.status!==401&&error.status!==403)status.textContent=error.message;}
